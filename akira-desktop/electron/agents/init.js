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

  // Get orchestrator and update its tools
  const orchestrator = getAgent('orchestrator');
  if (orchestrator) {
    orchestrator.toolDefinitions = delegateTool.definitions;
    orchestrator.toolHandlers = delegateTool.handlers;
    console.log('[agents] Orchestrator tools:', orchestrator.toolDefinitions.map(t => t.name));
  }

  // Update specialist agents with communication tools
  const specialists = ['file', 'system', 'web', 'memory', 'desktop'];
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

  // Execute orchestrator
  const result = await executeAgent({
    agentName: 'orchestrator',
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

module.exports = {
  initializeAgents,
  runOrchestrator,
  setWorkspaceRoot,
  isInitialized,
  getAvailableAgents,
  createExecutionContext,
  // Cache functions
  clearCache,
  getCacheStats,
  removeCacheEntry
};
