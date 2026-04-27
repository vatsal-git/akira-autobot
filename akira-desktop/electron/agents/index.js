/**
 * Agent Registry
 * Manages all agents and provides agent-to-agent communication
 */

const { BaseAgent } = require('./base-agent');

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
 * @param {string} params.task - The task to perform
 * @param {Array} params.conversationHistory - Previous messages for context
 * @param {string} params.context - Additional context
 * @param {Object} params.apiConfig - API configuration
 * @param {Function} params.onEvent - Event callback
 * @param {AbortSignal} params.signal - Cancellation signal
 * @param {string} params.parentAgent - Name of calling agent (for tracking)
 * @returns {Promise<Object>}
 */
async function executeAgent({
  agentName,
  task,
  conversationHistory = [],
  context = '',
  apiConfig,
  onEvent,
  signal,
  parentAgent = null
}) {
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

  // Track execution
  const executionId = `${agentName}-${Date.now()}`;
  activeExecutions.set(executionId, {
    agent: agentName,
    task,
    parentAgent,
    startTime: Date.now()
  });

  // Emit delegation event if called by another agent
  if (parentAgent) {
    onEvent?.({
      type: 'agent_delegate',
      fromAgent: parentAgent,
      toAgent: agentName,
      task: task
    });
  }

  currentExecutionDepth++;

  try {
    const result = await agent.execute({
      task,
      context,
      conversationHistory,
      apiConfig,
      onEvent,
      signal
    });

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
  const definitions = [
    {
      name: 'request_agent_help',
      description: `Request help from another specialized agent. Available agents: ${Array.from(agents.keys()).filter(n => n !== currentAgentName && n !== 'orchestrator').join(', ')}`,
      input_schema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: Array.from(agents.keys()).filter(n => n !== currentAgentName && n !== 'orchestrator'),
            description: 'Name of the agent to request help from'
          },
          task: {
            type: 'string',
            description: 'What you need the other agent to do'
          },
          context: {
            type: 'string',
            description: 'Additional context to help the other agent'
          }
        },
        required: ['agent', 'task']
      }
    }
  ];

  const handlers = {
    async request_agent_help(input) {
      const { agent: targetAgent, task, context = '' } = input;

      // Don't allow calling self or orchestrator
      if (targetAgent === currentAgentName) {
        return { success: false, error: 'Cannot request help from yourself' };
      }
      if (targetAgent === 'orchestrator') {
        return { success: false, error: 'Cannot call orchestrator from specialized agent' };
      }

      const result = await executeAgent({
        agentName: targetAgent,
        task,
        context,
        apiConfig,
        onEvent,
        signal,
        parentAgent: currentAgentName
      });

      return result;
    }
  };

  return { definitions, handlers };
}

/**
 * Create the delegate_agent tool for the orchestrator
 */
function createDelegateAgentTool(apiConfig, onEvent, signal) {
  const specialistAgents = Array.from(agents.keys()).filter(n => n !== 'orchestrator');

  const definitions = [
    {
      name: 'delegate_agent',
      description: `Delegate a task to a specialized agent. Each agent has specific capabilities:\n${
        specialistAgents.map(name => {
          const agent = getAgent(name);
          return `- ${name}: ${agent?.description || 'No description'}`;
        }).join('\n')
      }`,
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
          context: {
            type: 'string',
            description: 'Additional context or requirements'
          }
        },
        required: ['agent', 'task']
      }
    }
  ];

  const handlers = {
    async delegate_agent(input) {
      const { agent: targetAgent, task, context = '' } = input;

      if (targetAgent === 'orchestrator') {
        return { success: false, error: 'Cannot delegate to orchestrator' };
      }

      const result = await executeAgent({
        agentName: targetAgent,
        task,
        context,
        apiConfig,
        onEvent,
        signal,
        parentAgent: 'orchestrator'
      });

      return result;
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
  BaseAgent
};
