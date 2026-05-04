/**
 * Base Agent Module
 * Provides the foundation for all specialized agents in Akira
 */

const { executeTool } = require('../tools');
const { callProvider } = require('../providers/adapter');
const { startTask } = require('./async-task-manager');
const { parseTask, formatTaskForPrompt, extractTaskString, isInternalTask, requiresSummary } = require('./task');
const { isEmergencyStopped } = require('./control');

// Maximum iterations to prevent infinite loops
const MAX_TOOL_ITERATIONS = 20;

/**
 * Extract image data from a tool result if present
 * Supports nested result structures like { success: true, result: { base64, format } }
 */
function extractImageData(toolResult) {
  // Direct image data
  if (toolResult?.base64 && toolResult?.format) {
    return {
      base64: toolResult.base64,
      format: toolResult.format,
      mediaType: `image/${toolResult.format}`,
      width: toolResult.width,
      height: toolResult.height
    };
  }
  // Nested in result property (common pattern)
  if (toolResult?.result?.base64 && toolResult?.result?.format) {
    return {
      base64: toolResult.result.base64,
      format: toolResult.result.format,
      mediaType: `image/${toolResult.result.format}`,
      width: toolResult.result.width,
      height: toolResult.result.height
    };
  }
  return null;
}

/**
 * Remove base64 data from tool result to avoid bloating message history
 * Returns a copy with base64 replaced by a placeholder
 */
function removeBase64FromResult(toolResult) {
  const copy = JSON.parse(JSON.stringify(toolResult));
  if (copy?.base64) {
    copy.base64 = '[IMAGE_DATA]';
  }
  if (copy?.result?.base64) {
    copy.result.base64 = '[IMAGE_DATA]';
  }
  return copy;
}

// Tools that produce large OCR/UI parsing output that should be summarized in history
const OCR_TOOLS = ['desktop_ui_parse', 'desktop_screen_query'];

// Tools whose results can be summarized to just success/failure for older messages
const SUMMARIZABLE_TOOLS = [
  'desktop_mouse', 'desktop_keyboard', 'desktop_wait',
  'desktop_ui_parse', 'desktop_screen_query', 'desktop_diagnose'
];

/**
 * Check if a tool produces OCR/screenshot output
 */
function isOcrTool(toolName) {
  return OCR_TOOLS.includes(toolName);
}

/**
 * Generate a summary of content based on hint
 * @param {*} content - Content to summarize
 * @param {string} hint - Summary hint
 * @returns {string}
 */
function generateSummary(content, hint) {
  if (!content) return 'Task completed';

  // If there's a hint, try to generate guided summary
  if (hint) {
    const hintLower = hint.toLowerCase();

    // Count-based hints
    if (hintLower.includes('count')) {
      if (Array.isArray(content)) {
        return `Found ${content.length} items`;
      }
      if (typeof content === 'object' && content.count !== undefined) {
        return `Count: ${content.count}`;
      }
    }

    // Status hints
    if (hintLower.includes('status')) {
      if (typeof content === 'object') {
        if (content.success !== undefined) {
          return content.success ? '✓ Success' : `✗ Failed: ${content.error || 'Unknown error'}`;
        }
      }
    }
  }

  // Auto-generate based on content type
  if (typeof content === 'string') {
    if (content.length <= 100) return content;
    return content.substring(0, 97) + '...';
  }

  if (Array.isArray(content)) {
    return `Completed with ${content.length} items`;
  }

  if (typeof content === 'object') {
    if (content.success !== undefined) {
      return content.success
        ? '✓ Completed successfully'
        : `✗ Failed: ${content.error || 'Unknown error'}`;
    }
    if (content.content) {
      const text = String(content.content);
      return text.length <= 100 ? text : text.substring(0, 97) + '...';
    }
  }

  return 'Task completed';
}

/**
 * Emit event with visibility handling
 * @param {Object} event - Event to emit
 * @param {Object} taskDef - Task definition with output.visibility
 * @param {Function} onEvent - Event callback
 */
function emitWithVisibility(event, taskDef, onEvent) {
  if (!onEvent) return;

  const visibility = taskDef?.output?.visibility || 'user';

  switch (event.type) {
    case 'agent_start':
    case 'thinking':
    case 'tool_use':
    case 'text_delta':
      // Always show agent activity
      onEvent({
        ...event,
        _visibility: 'activity'
      });
      break;

    case 'agent_complete':
    case 'tool_result':
      if (visibility === 'user') {
        // Full output to user
        onEvent({ ...event, _visibility: 'full' });
      } else if (visibility === 'user-summary') {
        // Generate summary
        const summary = generateSummary(
          event.result || event.content,
          taskDef?.output?.summaryHint
        );
        onEvent({
          ...event,
          _visibility: 'summary',
          displayContent: summary,
          fullContent: event.result || event.content
        });
      } else if (visibility === 'internal') {
        // Mark as internal - UI can decide to hide or show minimal indicator
        onEvent({
          ...event,
          _visibility: 'internal',
          _suppressDisplay: true
        });
      }
      break;

    default:
      // Pass through other events
      onEvent({ ...event, _visibility: visibility });
  }
}

/**
 * Summarize a tool result to just success/failure status
 */
function summarizeToolResult(toolName, toolResult) {
  try {
    const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
    const success = parsed?.success !== false && !parsed?.error;

    // For OCR tools, include element count if available
    if (toolName === 'desktop_ui_parse' && parsed?.element_count !== undefined) {
      return JSON.stringify({
        success,
        summary: `Found ${parsed.element_count} UI elements`,
        parse_session_id: parsed.parse_session_id
      });
    }

    // For screenshot, just indicate it was taken
    if (toolName === 'desktop_screen_query') {
      return JSON.stringify({
        success,
        summary: parsed?.error ? `Failed: ${parsed.error}` : 'Screenshot captured'
      });
    }

    // For action tools, summarize the action
    if (toolName === 'desktop_mouse' || toolName === 'desktop_keyboard') {
      return JSON.stringify({
        success,
        summary: parsed?.error ? `Failed: ${parsed.error}` : 'Action completed'
      });
    }

    // Default summary
    return JSON.stringify({
      success,
      summary: parsed?.error || (success ? 'Completed' : 'Failed')
    });
  } catch {
    return toolResult; // Return original if can't parse
  }
}

/**
 * Filter and compress message history to reduce context size
 * Keeps only the most recent OCR results in full, summarizes older ones
 * @param {Array} messages - Full message history
 * @param {number} keepRecentOcr - Number of recent OCR results to keep in full (default 2)
 * @returns {Array} Filtered messages
 */
function filterMessageHistory(messages, keepRecentOcr = 2) {
  // Find indices of OCR tool results (from most recent to oldest)
  const ocrIndices = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'tool' && msg._toolName && isOcrTool(msg._toolName)) {
      ocrIndices.push(i);
    }
  }

  // Indices of OCR results to summarize (all except the most recent N)
  const indicesToSummarize = new Set(ocrIndices.slice(keepRecentOcr));

  // Also track assistant messages with thinking to potentially strip
  const filteredMessages = messages.map((msg, idx) => {
    // Summarize old OCR tool results
    if (indicesToSummarize.has(idx) && msg.role === 'tool') {
      const summarized = { ...msg };
      summarized.content = summarizeToolResult(msg._toolName, msg.content);
      // Remove image data from old OCR results
      delete summarized._imageData;
      return summarized;
    }

    // For tool messages with summarizable tools that are older, summarize them
    if (msg.role === 'tool' && msg._toolName && SUMMARIZABLE_TOOLS.includes(msg._toolName)) {
      // Keep recent tool results (last 5 tool messages)
      const toolMsgCount = messages.slice(idx).filter(m => m.role === 'tool').length;
      if (toolMsgCount > 5 && !isOcrTool(msg._toolName)) {
        const summarized = { ...msg };
        summarized.content = summarizeToolResult(msg._toolName, msg.content);
        return summarized;
      }
    }

    return msg;
  });

  return filteredMessages;
}

/**
 * Base Agent class that all specialized agents extend
 */
class BaseAgent {
  /**
   * @param {Object} config - Agent configuration
   * @param {string} config.name - Agent name (e.g., 'dobby', 'samba', 'akira')
   * @param {string} config.displayName - Human-readable name for UI
   * @param {string} config.description - What this agent does
   * @param {string} config.systemPrompt - System prompt for this agent
   * @param {Array} config.toolDefinitions - Tool definitions this agent can use
   * @param {Object} config.toolHandlers - Tool handlers this agent can use
   */
  constructor(config) {
    this.name = config.name;
    this.displayName = config.displayName || config.name;
    this.description = config.description || '';
    this.systemPrompt = config.systemPrompt || '';
    this.toolDefinitions = config.toolDefinitions || [];
    this.toolHandlers = config.toolHandlers || {};

    // Runtime state
    this.isRunning = false;
    this.currentTask = null;
    this.currentTaskDef = null;
  }

  /**
   * Get tools formatted for OpenRouter API
   * @returns {Array} Tools in OpenRouter/OpenAI format
   */
  getToolsForAPI() {
    return this.toolDefinitions.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  /**
   * Execute a tool by name
   * @param {string} toolName - Name of the tool to execute
   * @param {Object} input - Tool input parameters
   * @returns {Promise<Object>} Tool execution result
   */
  async executeTool(toolName, input) {
    console.log(`[${this.name}] Attempting to execute tool: ${toolName}`);
    console.log(`[${this.name}] Available tools: ${Object.keys(this.toolHandlers).join(', ')}`);

    // First check agent's own handlers
    if (this.toolHandlers[toolName]) {
      try {
        const result = await this.toolHandlers[toolName](input);
        return { success: true, result };
      } catch (error) {
        console.error(`[${this.name}] Tool ${toolName} error:`, error);
        return { success: false, error: error.message };
      }
    }

    console.log(`[${this.name}] Tool ${toolName} not found in agent handlers, trying global`);
    // Fall back to global tool execution
    return await executeTool(toolName, input);
  }

  /**
   * Build messages array for LLM call
   * @param {Object|string} taskDef - The task definition or string
   * @param {string} context - Additional context
   * @param {Array} conversationHistory - Previous messages
   * @returns {Array} Messages array for API
   */
  buildMessages(taskDef, context = '', conversationHistory = []) {
    const messages = [
      { role: 'system', content: this.systemPrompt }
    ];

    // Add conversation history if provided
    if (conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    // Build the task message - handle both structured and string tasks
    let taskMessage;

    if (typeof taskDef === 'object' && taskDef.task) {
      // Structured task - format it properly
      taskMessage = formatTaskForPrompt(taskDef);
    } else if (typeof taskDef === 'string') {
      taskMessage = taskDef;
    } else {
      taskMessage = extractTaskString(taskDef);
    }

    if (context) {
      taskMessage = `Context: ${context}\n\n${taskMessage}`;
    }

    messages.push({ role: 'user', content: taskMessage });

    return messages;
  }

  /**
   * Execute the agent with a task
   * This method should be overridden by specialized agents if they need custom behavior
   *
   * @param {Object} params - Execution parameters
   * @param {string|Object} params.task - The task to perform (string or structured TaskDefinition)
   * @param {string} params.context - Additional context
   * @param {Array} params.conversationHistory - Previous messages for context
   * @param {Object} params.apiConfig - API configuration (apiKey, model, temperature)
   * @param {Function} params.onEvent - Callback for streaming events
   * @param {AbortSignal} params.signal - AbortController signal for cancellation
   * @returns {Promise<Object>} Execution result
   */
  async execute({ task, context = '', conversationHistory = [], apiConfig, onEvent, signal }) {
    // Check for emergency stop
    if (isEmergencyStopped()) {
      return {
        success: false,
        error: 'Execution blocked - emergency stop is active',
        emergencyStopped: true
      };
    }

    // Parse task into structured format
    const { success: parseSuccess, task: parsedTask, error: parseError } = parseTask(task, {
      fromAgent: 'akira',
      toAgent: this.name
    });

    // Store parsed task for visibility handling
    this.currentTaskDef = parseSuccess ? parsedTask : { task: extractTaskString(task), output: { visibility: 'user' } };
    const taskString = extractTaskString(task);

    this.isRunning = true;
    this.currentTask = taskString;

    // Emit agent start event with visibility
    emitWithVisibility({
      type: 'agent_start',
      agent: this.name,
      displayName: this.displayName,
      task: taskString,
      hasScope: parseSuccess && (parsedTask.scope?.do?.length > 0 || parsedTask.scope?.dont?.length > 0)
    }, this.currentTaskDef, onEvent);

    try {
      const result = await this.runConversationLoop({
        task: this.currentTaskDef,
        context,
        conversationHistory,
        apiConfig,
        onEvent,
        signal
      });

      // Emit agent complete event with visibility handling
      emitWithVisibility({
        type: 'agent_complete',
        agent: this.name,
        displayName: this.displayName,
        result: result
      }, this.currentTaskDef, onEvent);

      return result;

    } catch (error) {
      onEvent?.({
        type: 'agent_error',
        agent: this.name,
        error: error.message
      });
      throw error;

    } finally {
      this.isRunning = false;
      this.currentTask = null;
      this.currentTaskDef = null;
    }
  }

  /**
   * Run the main conversation loop with tool execution
   * @private
   */
  async runConversationLoop({ task, context, conversationHistory = [], apiConfig, onEvent, signal }) {
    let messages = this.buildMessages(task, context, conversationHistory);
    let iterations = 0;
    let finalContent = '';

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Check for cancellation
      if (signal?.aborted) {
        throw new Error('Agent execution cancelled');
      }

      // Check for emergency stop
      if (isEmergencyStopped()) {
        return {
          success: false,
          content: finalContent,
          error: 'Emergency stop triggered',
          emergencyStopped: true,
          iterations
        };
      }

      // Call LLM
      const response = await this.callLLM({
        messages,
        apiConfig,
        onEvent,
        signal
      });

      // Accumulate content
      if (response.content) {
        finalContent += response.content;
      }

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          success: true,
          content: finalContent,
          iterations
        };
      }

      // Execute tool calls
      const assistantMessage = {
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls,
        thinking: response.thinking // Preserve as-is (including empty string) for proper thinking block handling
      };
      messages.push(assistantMessage);

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name;
        let toolArgs = {};

        try {
          toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          toolArgs = {};
        }

        // Extract run_type and remove from args passed to tool
        const runType = toolArgs.run_type || 'sync';
        delete toolArgs.run_type;

        // Emit tool use event
        onEvent?.({
          type: 'tool_use',
          agent: this.name,
          toolId: toolCall.id,
          name: toolName,
          input: toolArgs,
          runType: runType
        });

        let toolResult;
        let toolMessage;

        if (runType === 'async') {
          // Start async task - returns immediately with task_id
          const { taskId } = startTask({
            name: `${toolName}`,
            type: 'tool',
            metadata: {
              agent: this.name,
              toolCallId: toolCall.id,
              toolName: toolName
            },
            executor: () => this.executeTool(toolName, toolArgs)
          });

          toolResult = {
            success: true,
            async: true,
            task_id: taskId,
            message: `Task started asynchronously. Use await_tasks(["${taskId}"]) to get results.`
          };

          // Emit async task started event
          onEvent?.({
            type: 'async_task_started',
            agent: this.name,
            toolId: toolCall.id,
            taskId: taskId,
            name: toolName
          });

          toolMessage = {
            role: 'tool',
            tool_call_id: toolCall.id,
            _toolName: toolName,
            content: JSON.stringify(toolResult)
          };
        } else {
          // Sync execution - wait for result
          toolResult = await this.executeTool(toolName, toolArgs);

          // Build tool result message, handling images specially
          toolMessage = {
            role: 'tool',
            tool_call_id: toolCall.id,
            _toolName: toolName,
          };

          // Check if result contains image data (e.g., from screenshot)
          const imageData = extractImageData(toolResult);
          if (imageData) {
            toolMessage._imageData = imageData;
            const resultWithoutBase64 = removeBase64FromResult(toolResult);
            toolMessage.content = JSON.stringify(resultWithoutBase64);
          } else {
            toolMessage.content = JSON.stringify(toolResult);
          }

          // Emit tool result event with visibility
          emitWithVisibility({
            type: 'tool_result',
            agent: this.name,
            toolId: toolCall.id,
            name: toolName,
            result: toolResult
          }, this.currentTaskDef, onEvent);
        }

        messages.push(toolMessage);
      }
    }

    // Max iterations reached
    return {
      success: false,
      content: finalContent,
      error: 'Maximum tool iterations reached',
      iterations
    };
  }

  /**
   * Call the LLM API using the provider adapter
   * @private
   */
  async callLLM({ messages, apiConfig, onEvent, signal }) {
    const { apiKey, model, temperature = 0.7, maxTokens, thinkingBudget, provider = 'openrouter', credentials = {}, reasoningEnabled = true, disabledTools = [] } = apiConfig;

    // Filter message history to reduce context size (keep latest 2 OCR results in full)
    const filteredMessages = filterMessageHistory(messages, 2);
    console.log(`[${this.name}] Message history: ${messages.length} total, ${filteredMessages.length} after filtering`);

    // Get tools and filter out disabled ones
    let tools = this.getToolsForAPI();
    if (disabledTools.length > 0) {
      tools = tools.filter(t => !disabledTools.includes(t.function.name));
    }
    console.log(`[${this.name}] Calling ${provider} with model ${model} and ${tools.length} tools:`, tools.map(t => t.function.name));

    // Use the provider adapter for the API call
    const agentName = this.name;
    return await callProvider({
      providerId: provider,
      messages: filteredMessages,
      tools,
      apiKey,
      model,
      temperature,
      maxTokens,
      thinkingBudget,
      signal,
      credentials,
      reasoningEnabled,
      onEvent: (evt) => {
        // Add agent name to events
        onEvent?.({ ...evt, agent: agentName });
      }
    });
  }

  /**
   * Get agent info for UI display
   */
  getInfo() {
    return {
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      tools: this.toolDefinitions.map(t => t.name),
      isRunning: this.isRunning,
      currentTask: this.currentTask
    };
  }
}

module.exports = { BaseAgent };
