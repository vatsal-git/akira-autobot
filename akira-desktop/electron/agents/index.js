/**
 * Agent Registry
 * Manages all agents and provides agent-to-agent communication
 */

const { BaseAgent } = require('./base-agent');
const {
  startTask,
  awaitTasks,
  awaitAllPending,
  getPendingTasks,
  getTaskStatus,
  getTask,
  cancelAllPendingTasks
} = require('./async-task-manager');
const {
  parseTask,
  extractTaskString,
  formatMetadataPrefix,
  applyDefaults,
  createTaskMeta
} = require('./task');
const {
  getAgentSummaryForPrompt,
  getAgentListForTool,
  validateTaskForAgent
} = require('./capabilities');
const {
  createEmergencyStopTool,
  createClarificationTool,
  isEmergencyStopped,
  clearEmergencyState
} = require('./control');

// Agent registry - populated when agents are registered
const agents = new Map();

// Track active agent executions for UI
const activeExecutions = new Map();

// Execution depth tracking to prevent infinite loops
let currentExecutionDepth = 0;
const MAX_EXECUTION_DEPTH = 5;

/**
 * Register an agent in the registry
 * @param {BaseAgent} agent - The agent instance to register
 */
function registerAgent(agent) {
  if (!(agent instanceof BaseAgent)) {
    throw new Error('Agent must be an instance of BaseAgent');
  }
  agents.set(agent.name, agent);
  console.log(`[agents] Registered agent: ${agent.name}`);
}

/**
 * Get an agent by name
 * @param {string} name - Agent name
 * @returns {BaseAgent|null}
 */
function getAgent(name) {
  return agents.get(name) || null;
}

/**
 * Get all registered agents
 * @returns {Array<BaseAgent>}
 */
function getAllAgents() {
  return Array.from(agents.values());
}

/**
 * Get agent info for all agents (for UI)
 * @returns {Array<Object>}
 */
function getAgentInfoList() {
  return getAllAgents().map(agent => agent.getInfo());
}

/**
 * Execute an agent with a task
 * This is the main entry point for running agents
 *
 * @param {Object} params - Execution parameters
 * @param {string} params.agentName - Name of agent to execute
 * @param {string|Object} params.task - The task to perform (string or TaskDefinition)
 * @param {Object} [params.scope] - Task scope (do/dont lists)
 * @param {Object} [params.output] - Output configuration (visibility, format)
 * @param {Object} [params.execution] - Execution configuration
 * @param {Array} params.conversationHistory - Previous messages for context
 * @param {string} params.context - Additional context
 * @param {Object} params.apiConfig - API configuration
 * @param {Function} params.onEvent - Event callback
 * @param {AbortSignal} params.signal - Cancellation signal
 * @param {string} params.parentAgent - Name of calling agent (for tracking)
 * @param {string} params.taskType - Type of task: 'assigned' (directive) or 'request' (can decline)
 * @returns {Promise<Object>}
 */
async function executeAgent({
  agentName,
  task,
  scope,
  output,
  execution,
  conversationHistory = [],
  context = '',
  apiConfig,
  onEvent,
  signal,
  parentAgent = null,
  taskType = 'assigned'
}) {
  // Check for emergency stop
  if (isEmergencyStopped()) {
    return {
      success: false,
      error: 'Execution blocked - emergency stop is active',
      emergencyStopped: true
    };
  }

  const agent = getAgent(agentName);
  if (!agent) {
    return {
      success: false,
      error: `Agent '${agentName}' not found. Available agents: ${Array.from(agents.keys()).join(', ')}`
    };
  }

  // Check execution depth
  if (currentExecutionDepth >= MAX_EXECUTION_DEPTH) {
    return {
      success: false,
      error: `Maximum agent execution depth (${MAX_EXECUTION_DEPTH}) exceeded. This may indicate an infinite loop.`
    };
  }

  // Build structured task definition
  let taskDef;
  if (typeof task === 'object' && task.task) {
    // Already a task definition
    taskDef = task;
  } else {
    // Build from parameters
    taskDef = {
      task: typeof task === 'string' ? task : extractTaskString(task),
      scope: scope || {},
      output: output || { visibility: 'user' },
      execution: execution || {}
    };
  }

  // Add metadata
  taskDef._meta = createTaskMeta({
    fromAgent: parentAgent || 'user',
    toAgent: agentName,
    depth: currentExecutionDepth
  });

  // Validate task for agent
  const validation = validateTaskForAgent(agentName, taskDef.task);
  if (validation.warnings.length > 0) {
    console.warn(`[agents] Task validation warnings for ${agentName}:`, validation.warnings);
  }

  // Track execution
  const executionId = `${agentName}-${Date.now()}`;
  activeExecutions.set(executionId, {
    agent: agentName,
    task: taskDef.task,
    taskDef,
    parentAgent,
    taskType,
    startTime: Date.now()
  });

  // Emit delegation event if called by another agent
  if (parentAgent) {
    onEvent?.({
      type: 'agent_delegate',
      fromAgent: parentAgent,
      toAgent: agentName,
      task: taskDef.task,
      taskType: taskType,
      visibility: taskDef.output?.visibility || 'user',
      hasScope: !!(taskDef.scope?.do?.length || taskDef.scope?.dont?.length)
    });
  }

  currentExecutionDepth++;

  try {
    const result = await agent.execute({
      task: taskDef,
      context,
      conversationHistory,
      apiConfig,
      onEvent,
      signal
    });

    const visibility = taskDef.output?.visibility || 'user';
    if (result && result.success && result.content && parentAgent && visibility === 'user') {
      result.content = `${result.content}\n\n[SYSTEM NOTE: The response above has already been fully streamed and displayed to the user. Do NOT repeat, summarize, or rewrite the details of this response in your final reply. Instead, just output a very brief wrap-up (e.g. "I have displayed the list above.") or ask if the user has any follow-up questions. Keep your response extremely short.]`;
    }

    return result;

  } finally {
    currentExecutionDepth--;
    activeExecutions.delete(executionId);
  }
}

/**
 * Create the special tools that allow agents to communicate
 * These are injected into specialized agents
 */
function createAgentCommunicationTools(currentAgentName, apiConfig, onEvent, signal) {
  const otherSpecialists = Array.from(agents.keys()).filter(n => n !== currentAgentName && n !== 'akira');

  // Get emergency stop and clarification tool definitions
  const emergencyStopTool = createEmergencyStopTool();
  const clarificationTool = createClarificationTool();

  const definitions = [
    {
      name: 'list_agents',
      description: 'Get a list of available agents and their capabilities. Use this to discover what agents you can collaborate with.',
      input_schema: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['summary', 'full'],
            description: 'Level of detail: summary (default) or full capabilities'
          }
        },
        required: []
      }
    },
    {
      name: 'assign_task',
      description: `Assign a task to another agent with optional scope and visibility control. This is a directive - the target agent must execute it.`,
      input_schema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: otherSpecialists,
            description: 'Name of the agent to assign the task to'
          },
          task: {
            type: 'string',
            description: 'Clear description of what the agent needs to do'
          },
          scope: {
            type: 'object',
            description: 'Task boundaries',
            properties: {
              do: { type: 'array', items: { type: 'string' }, description: 'Actions to take' },
              dont: { type: 'array', items: { type: 'string' }, description: 'Actions to avoid' }
            }
          },
          output: {
            type: 'object',
            description: 'Output configuration',
            properties: {
              visibility: {
                type: 'string',
                enum: ['user', 'internal', 'user-summary'],
                description: 'user: show to user, internal: return to you only, user-summary: brief summary to user'
              },
              summaryHint: { type: 'string', description: 'Hint for generating summary (when visibility is user-summary)' }
            }
          },
          context: {
            type: 'string',
            description: 'Additional context to help the agent'
          },
          priority: {
            type: 'string',
            enum: ['normal', 'high'],
            description: 'Task priority level (default: normal)'
          },
          run_type: {
            type: 'string',
            enum: ['sync', 'async'],
            description: 'sync: wait for result (default). async: return task_id for parallel execution'
          }
        },
        required: ['agent', 'task']
      }
    },
    {
      name: 'request_help',
      description: `Request help from another agent. This is a request - the target agent may decline if they cannot help.`,
      input_schema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: otherSpecialists,
            description: 'Name of the agent to request help from'
          },
          question: {
            type: 'string',
            description: 'What you need help with or want to ask'
          },
          output: {
            type: 'object',
            description: 'Output configuration',
            properties: {
              visibility: {
                type: 'string',
                enum: ['user', 'internal', 'user-summary'],
                description: 'Visibility of the response'
              }
            }
          },
          context: {
            type: 'string',
            description: 'Additional context for the request'
          },
          run_type: {
            type: 'string',
            enum: ['sync', 'async'],
            description: 'sync: wait for result (default). async: return task_id for parallel execution'
          }
        },
        required: ['agent', 'question']
      }
    },
    {
      name: 'escalate_to_orchestrator',
      description: 'Escalate a task back to Akira for re-routing. Use when you cannot handle a task, need coordination across multiple agents, or the task is outside your capabilities.',
      input_schema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why you are escalating this task'
          },
          task: {
            type: 'string',
            description: 'The task that needs to be handled'
          },
          attempted: {
            type: 'string',
            description: 'What you already tried (optional)'
          }
        },
        required: ['reason', 'task']
      }
    },
    {
      name: 'await_tasks',
      description: 'Wait for specific async tasks to complete and get their results.',
      input_schema: {
        type: 'object',
        properties: {
          task_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of task IDs to wait for. Omit to wait for all pending.'
          },
          timeout: {
            type: 'number',
            description: 'Max time to wait in milliseconds (default: 60000)'
          }
        },
        required: []
      }
    },
    {
      name: 'get_pending_tasks',
      description: 'Get list of all currently pending or running async tasks.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'get_task_status',
      description: 'Get the status of a specific async task without waiting for it.',
      input_schema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The task ID to check'
          }
        },
        required: ['task_id']
      }
    },
    // Add emergency stop tool
    emergencyStopTool.definition,
    // Add clarification tool
    clarificationTool.definition
  ];

  const handlers = {
    async list_agents(input) {
      const { detail = 'summary' } = input || {};
      const agentList = getAgentListForTool(detail);

      // Filter out current agent
      const filtered = agentList.filter(a => a.name !== currentAgentName && a.name !== 'akira');

      return {
        success: true,
        your_name: currentAgentName,
        available_agents: filtered
      };
    },

    async assign_task(input) {
      const { agent: targetAgent, task, scope, output, context = '', priority = 'normal', run_type = 'sync' } = input;

      if (targetAgent === currentAgentName) {
        return { success: false, error: 'Cannot assign task to yourself' };
      }

      const taskContext = priority === 'high' ? `[HIGH PRIORITY] ${context}` : context;

      // Build execution params with structured task
      const execParams = {
        agentName: targetAgent,
        task,
        scope,
        output: output || { visibility: 'user' },
        context: taskContext,
        apiConfig,
        onEvent,
        signal,
        parentAgent: currentAgentName,
        taskType: 'assigned'
      };

      if (run_type === 'async') {
        const { taskId } = startTask({
          name: `assign_task:${targetAgent}`,
          type: 'agent',
          metadata: {
            agent: currentAgentName,
            targetAgent,
            task,
            visibility: output?.visibility || 'user'
          },
          executor: () => executeAgent(execParams)
        });

        return {
          success: true,
          async: true,
          task_id: taskId,
          message: `Task assigned to ${targetAgent} asynchronously. Use await_tasks(["${taskId}"]) to get results.`
        };
      }

      return await executeAgent(execParams);
    },

    async request_help(input) {
      const { agent: targetAgent, question, output, context = '', run_type = 'sync' } = input;

      if (targetAgent === currentAgentName) {
        return { success: false, error: 'Cannot request help from yourself' };
      }

      const execParams = {
        agentName: targetAgent,
        task: question,
        output: output || { visibility: 'user' },
        context,
        apiConfig,
        onEvent,
        signal,
        parentAgent: currentAgentName,
        taskType: 'request'
      };

      if (run_type === 'async') {
        const { taskId } = startTask({
          name: `request_help:${targetAgent}`,
          type: 'agent',
          metadata: {
            agent: currentAgentName,
            targetAgent,
            question,
            visibility: output?.visibility || 'user'
          },
          executor: () => executeAgent(execParams)
        });

        return {
          success: true,
          async: true,
          task_id: taskId,
          message: `Help requested from ${targetAgent} asynchronously. Use await_tasks(["${taskId}"]) to get results.`
        };
      }

      return await executeAgent(execParams);
    },

    async escalate_to_orchestrator(input) {
      const { reason, task, attempted = '' } = input;

      const escalationContext = `Escalated from ${currentAgentName}.\nReason: ${reason}${attempted ? `\nAlready attempted: ${attempted}` : ''}`;

      return await executeAgent({
        agentName: 'akira',
        task,
        context: escalationContext,
        apiConfig,
        onEvent,
        signal,
        parentAgent: currentAgentName,
        taskType: 'escalation'
      });
    },

    async await_tasks(input) {
      const { task_ids = [], timeout = 60000 } = input;

      let results;
      if (!task_ids || task_ids.length === 0) {
        const result = await awaitAllPending(currentAgentName);
        results = result.results || {};
      } else {
        results = await awaitTasks(task_ids, timeout);
      }

      let successCount = 0;
      let failCount = 0;
      for (const taskId of Object.keys(results)) {
        const taskResult = results[taskId];
        if (taskResult.success) {
          successCount++;
        } else {
          failCount++;
        }

        // Emit async_task_result event so the original tool status can be updated
        const task = getTask(taskId);
        if (task && task.metadata?.toolCallId) {
          onEvent?.({
            type: 'async_task_result',
            agent: task.metadata.agent || currentAgentName,
            taskId: taskId,
            toolId: task.metadata.toolCallId,
            toolName: task.metadata.toolName,
            result: taskResult.result || taskResult,
            success: taskResult.success
          });
        }
      }

      return {
        success: failCount === 0,
        summary: `${successCount} succeeded, ${failCount} failed`,
        results
      };
    },

    async get_pending_tasks() {
      const pending = getPendingTasks(currentAgentName);
      return {
        success: true,
        count: pending.length,
        tasks: pending
      };
    },

    async get_task_status(input) {
      const { task_id } = input;
      if (!task_id) {
        return { success: false, error: 'task_id is required' };
      }
      return getTaskStatus(task_id);
    },

    // Emergency stop handler
    async emergency_stop(input) {
      return await emergencyStopTool.handler(input, {
        agentName: currentAgentName,
        onEvent,
        cancelPendingTasks: () => cancelAllPendingTasks?.()
      });
    },

    // Clarification handler
    async request_clarification(input) {
      // Get current task metadata from active executions
      const activeExec = Array.from(activeExecutions.values())
        .find(e => e.agent === currentAgentName);

      const taskMeta = activeExec?.taskDef?._meta || {
        fromAgent: 'akira',
        toAgent: currentAgentName
      };

      return await clarificationTool.handler(input, {
        taskMeta,
        clarificationBudget: activeExec?.taskDef?.execution?.clarificationBudget || 2,
        onEvent
      });
    }
  };

  return { definitions, handlers };
}

/**
 * Create the delegate_agent tool for Akira (the orchestrator)
 */
function createDelegateAgentTool(apiConfig, onEvent, signal) {
  const specialistAgents = Array.from(agents.keys()).filter(n => n !== 'akira');

  // Get emergency stop tool
  const emergencyStopTool = createEmergencyStopTool();

  const definitions = [
    {
      name: 'delegate_agent',
      description: `Delegate a task to a specialized agent with optional scope and visibility control.

Agent capabilities:
${getAgentSummaryForPrompt('brief')}`,
      input_schema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: specialistAgents,
            description: 'Name of the specialized agent to delegate to'
          },
          task: {
            type: 'string',
            description: 'Clear, specific task for the agent to complete'
          },
          scope: {
            type: 'object',
            description: 'Define task boundaries',
            properties: {
              do: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific actions the agent SHOULD take'
              },
              dont: {
                type: 'array',
                items: { type: 'string' },
                description: 'Actions the agent should NOT take'
              }
            }
          },
          output: {
            type: 'object',
            description: 'Control how output is handled',
            properties: {
              visibility: {
                type: 'string',
                enum: ['user', 'internal', 'user-summary'],
                description: 'user: full output to user, internal: return to you only, user-summary: brief summary to user'
              },
              format: {
                type: 'string',
                enum: ['text', 'json', 'structured'],
                description: 'Expected output format'
              },
              summaryHint: {
                type: 'string',
                description: 'Hint for generating summary when visibility is user-summary'
              }
            }
          },
          context: {
            type: 'string',
            description: 'Additional context or requirements'
          },
          run_type: {
            type: 'string',
            enum: ['sync', 'async'],
            description: 'sync: wait for completion (default). async: return task_id for parallel execution'
          }
        },
        required: ['agent', 'task']
      }
    },
    {
      name: 'await_tasks',
      description: 'Wait for specific async tasks to complete and get their results.',
      input_schema: {
        type: 'object',
        properties: {
          task_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of task IDs to wait for. Omit to wait for all pending.'
          },
          timeout: {
            type: 'number',
            description: 'Max time to wait in milliseconds (default: 60000)'
          }
        },
        required: []
      }
    },
    {
      name: 'get_pending_tasks',
      description: 'Get list of all currently pending or running async tasks.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    // Emergency stop for Akira
    emergencyStopTool.definition
  ];

  const handlers = {
    async delegate_agent(input) {
      const { agent: targetAgent, task, scope, output, context = '', run_type = 'sync' } = input;

      if (targetAgent === 'akira') {
        return { success: false, error: 'Cannot delegate to Akira (self)' };
      }

      // Build execution params with structured task support
      const execParams = {
        agentName: targetAgent,
        task,
        scope,
        output: output || { visibility: 'user' },
        context,
        apiConfig,
        onEvent,
        signal,
        parentAgent: 'akira',
        taskType: 'assigned'
      };

      if (run_type === 'async') {
        const { taskId } = startTask({
          name: `delegate:${targetAgent}`,
          type: 'agent',
          metadata: {
            agent: 'akira',
            targetAgent,
            task,
            visibility: output?.visibility || 'user'
          },
          executor: () => executeAgent(execParams)
        });

        return {
          success: true,
          async: true,
          task_id: taskId,
          message: `Task delegated to ${targetAgent} asynchronously. Use await_tasks(["${taskId}"]) to get results.`
        };
      }

      return await executeAgent(execParams);
    },

    async await_tasks(input) {
      const { task_ids = [], timeout = 60000 } = input;

      let results;
      if (!task_ids || task_ids.length === 0) {
        const result = await awaitAllPending();
        results = result.results || {};
      } else {
        results = await awaitTasks(task_ids, timeout);
      }

      let successCount = 0;
      let failCount = 0;
      for (const taskId of Object.keys(results)) {
        const taskResult = results[taskId];
        if (taskResult.success) {
          successCount++;
        } else {
          failCount++;
        }

        // Emit async_task_result event so the original tool status can be updated
        const task = getTask(taskId);
        if (task && task.metadata?.toolCallId) {
          onEvent?.({
            type: 'async_task_result',
            agent: task.metadata.agent || 'akira',
            taskId: taskId,
            toolId: task.metadata.toolCallId,
            toolName: task.metadata.toolName,
            result: taskResult.result || taskResult,
            success: taskResult.success
          });
        }
      }

      return {
        success: failCount === 0,
        summary: `${successCount} succeeded, ${failCount} failed`,
        results
      };
    },

    async get_pending_tasks() {
      const pending = getPendingTasks();
      return {
        success: true,
        count: pending.length,
        tasks: pending
      };
    },

    // Emergency stop handler for Akira
    async emergency_stop(input) {
      return await emergencyStopTool.handler(input, {
        agentName: 'akira',
        onEvent,
        cancelPendingTasks: () => cancelAllPendingTasks?.()
      });
    }
  };

  return { definitions, handlers };
}

/**
 * Get current execution state for debugging/UI
 */
function getExecutionState() {
  return {
    depth: currentExecutionDepth,
    activeExecutions: Array.from(activeExecutions.entries()).map(([id, data]) => ({
      id,
      ...data,
      duration: Date.now() - data.startTime
    }))
  };
}

/**
 * Reset execution state (useful for testing or error recovery)
 */
function resetExecutionState() {
  currentExecutionDepth = 0;
  activeExecutions.clear();
}

module.exports = {
  // Registry functions
  registerAgent,
  getAgent,
  getAllAgents,
  getAgentInfoList,

  // Execution
  executeAgent,

  // Communication tools
  createAgentCommunicationTools,
  createDelegateAgentTool,

  // State management
  getExecutionState,
  resetExecutionState,

  // For type checking
  BaseAgent,

  // Re-export from submodules for convenience
  // Task utilities
  parseTask,
  extractTaskString,

  // Capabilities
  getAgentSummaryForPrompt,
  getAgentListForTool,
  validateTaskForAgent,

  // Control utilities
  isEmergencyStopped,
  clearEmergencyState
};
