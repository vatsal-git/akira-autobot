/**
 * Agent System Initialization
 * Sets up all agents and prepares them for use
 */

const {
  registerAgent,
  createAgentCommunicationTools,
  createDelegateAgentTool,
  executeAgent,
  getAgent,
  getAllAgents,
  getAgentInfoList,
  resetExecutionState
} = require('./index');

const {
  shouldCheckCache,
  getCachedResponse,
  cacheResponse,
  isCacheablePattern
} = require('./response-cache');

const { createFileAgent, setWorkspaceRoot: setFileWorkspace } = require('./specialists/file-agent');
const { createSystemAgent } = require('./specialists/system-agent');
const { createWebAgent } = require('./specialists/web-agent');
const { createMemoryAgent } = require('./specialists/memory-agent');
const { createDesktopAgent } = require('./specialists/desktop-agent');
const { createOrchestratorAgent } = require('./orchestrator');
const { createTodoTools } = require('./todo-tools');

let initialized = false;
let currentApiConfig = null;

/**
 * Initialize all agents
 * Must be called before using the agent system
 *
 * @param {Object} apiConfig - API configuration for agent communication tools
 */
function initializeAgents(apiConfig) {
  if (initialized) {
    console.log('[agents] Already initialized, skipping');
    return;
  }

  currentApiConfig = apiConfig;

  console.log('[agents] Initializing agent system...');

  // First, create and register specialist agents without communication tools
  // (We need them registered first so we can create communication tools)
  const fileAgent = createFileAgent();
  const systemAgent = createSystemAgent();
  const webAgent = createWebAgent();
  const memoryAgent = createMemoryAgent();
  const desktopAgent = createDesktopAgent();

  registerAgent(fileAgent);
  registerAgent(systemAgent);
  registerAgent(webAgent);
  registerAgent(memoryAgent);
  registerAgent(desktopAgent);

  // Create orchestrator with delegate tool
  // Note: delegate tool needs to be created after specialists are registered
  const orchestrator = createOrchestratorAgent();
  registerAgent(orchestrator);

  initialized = true;
  console.log('[agents] Agent system initialized with', getAllAgents().length, 'agents');
}

/**
 * Create a configured orchestrator for a specific execution
 * This creates fresh communication tools with the current API config
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.apiConfig - API configuration
 * @param {Function} options.onEvent - Event callback
 * @param {AbortSignal} options.signal - Cancellation signal
 * @returns {Object} Configured execution context
 */
function createExecutionContext({ apiConfig, onEvent, signal }) {
  // Create delegate tool for orchestrator
  const delegateTool = createDelegateAgentTool(apiConfig, onEvent, signal);

  // Create todo tools for orchestrator
  const todoTools = createTodoTools(onEvent);

  // Get orchestrator and update its tools (merge delegate + todo tools)
  const orchestrator = getAgent('akira');
  if (orchestrator) {
    orchestrator.toolDefinitions = [...delegateTool.definitions, ...todoTools.definitions];
    orchestrator.toolHandlers = { ...delegateTool.handlers, ...todoTools.handlers };
    console.log('[agents] Orchestrator tools:', orchestrator.toolDefinitions.map(t => t.name));
  }

  // Update specialist agents with communication tools
  const specialists = ['dobby', 'vektor', 'samba', 'smriti', 'beneges'];
  for (const name of specialists) {
    const agent = getAgent(name);
    if (agent) {
      const commTools = createAgentCommunicationTools(name, apiConfig, onEvent, signal);
      // Merge communication tools with existing tools
      const existingToolNames = agent.toolDefinitions.map(t => t.name);
      for (const def of commTools.definitions) {
        if (!existingToolNames.includes(def.name)) {
          agent.toolDefinitions.push(def);
        }
      }
      Object.assign(agent.toolHandlers, commTools.handlers);
    }
  }

  return {
    apiConfig,
    onEvent,
    signal,
    orchestrator
  };
}

/**
 * Run a user request through the orchestrator
 *
 * @param {Object} options - Execution options
 * @param {string} options.message - User message
 * @param {Array} options.conversationHistory - Previous messages for context
 * @param {Object} options.apiConfig - API configuration
 * @param {Function} options.onEvent - Event callback
 * @param {AbortSignal} options.signal - Cancellation signal
 * @param {boolean} options.skipCache - Skip cache lookup (for regeneration)
 * @returns {Promise<Object>} Execution result
 */
async function runOrchestrator({ message, conversationHistory = [], apiConfig, onEvent, signal, skipCache = false }) {
  if (!initialized) {
    initializeAgents(apiConfig);
  }

  // Check cache first (unless skipping)
  if (!skipCache && shouldCheckCache(message)) {
    const cached = getCachedResponse(message);
    if (cached) {
      console.log('[agents] Returning cached response');

      // Emit cached response event
      onEvent?.({
        type: 'cached_response',
        content: cached.response
      });

      // Stream the cached response as deltas for UI consistency
      onEvent?.({
        type: 'delta',
        agent: 'cache',
        delta: cached.response
      });

      return {
        success: true,
        content: cached.response,
        cached: true,
        iterations: 0
      };
    }
  }

  // Reset execution state for new request
  resetExecutionState();

  // Create fresh execution context
  createExecutionContext({ apiConfig, onEvent, signal });

  // Execute Akira (orchestrator)
  const result = await executeAgent({
    agentName: 'akira',
    task: message,
    conversationHistory,
    context: '',
    apiConfig,
    onEvent,
    signal
  });

  // Cache the response if it was a cacheable pattern and successful
  if (result.success && result.content && isCacheablePattern(message)) {
    cacheResponse(message, result.content);
  }

  return result;
}

/**
 * Run a user request directly to a specific agent (bypassing orchestrator)
 * Used when user tags an agent with @agentname syntax
 *
 * @param {Object} options - Execution options
 * @param {string} options.agentName - Name of agent to run directly
 * @param {string} options.message - User message (without the @tag)
 * @param {Array} options.conversationHistory - Previous messages for context
 * @param {Object} options.apiConfig - API configuration
 * @param {Function} options.onEvent - Event callback
 * @param {AbortSignal} options.signal - Cancellation signal
 * @returns {Promise<Object>} Execution result
 */
async function runDirectAgent({ agentName, message, conversationHistory = [], apiConfig, onEvent, signal }) {
  if (!initialized) {
    initializeAgents(apiConfig);
  }

  // Validate agent exists
  const agent = getAgent(agentName);
  if (!agent) {
    return {
      success: false,
      error: `Agent '${agentName}' not found`
    };
  }

  // Reset execution state for new request
  resetExecutionState();

  console.log(`[agents] Running direct agent: ${agentName}`);

  // Execute agent directly without communication tools
  // The agent will only have its own tools (no delegate, assign_task, etc.)
  const result = await executeAgent({
    agentName,
    task: message,
    conversationHistory,
    context: '',
    apiConfig,
    onEvent,
    signal,
    parentAgent: null,
    taskType: 'direct'
  });

  return result;
}

/**
 * Set workspace root for file operations
 */
function setWorkspaceRoot(root) {
  setFileWorkspace(root);
}

/**
 * Check if agents are initialized
 */
function isInitialized() {
  return initialized;
}

/**
 * Get current API configuration
 * Used by tools that need to make API calls (e.g., vision analysis)
 */
function getCurrentApiConfig() {
  return currentApiConfig;
}

/**
 * Get list of available agents for UI
 */
function getAvailableAgents() {
  return getAgentInfoList();
}

// Re-export cache functions for main.js
const {
  clearCache,
  getCacheStats,
  removeCacheEntry
} = require('./response-cache');

// Re-export control functions for main.js
const {
  submitUserResponse: submitEmergencyResponse,
  clearEmergencyState,
  getEmergencyState,
  submitClarificationResponse
} = require('./control');

// Re-export todo functions for main.js
const {
  getTodoList,
  clearTodoList,
  onTodoEvent
} = require('./todo-manager');

module.exports = {
  initializeAgents,
  runOrchestrator,
  runDirectAgent,
  setWorkspaceRoot,
  isInitialized,
  getAvailableAgents,
  createExecutionContext,
  getCurrentApiConfig,
  // Cache functions
  clearCache,
  getCacheStats,
  removeCacheEntry,
  // Control functions
  submitEmergencyResponse,
  clearEmergencyState,
  getEmergencyState,
  submitClarificationResponse,
  // Todo functions
  getTodoList,
  clearTodoList,
  onTodoEvent
};
