/**
 * Orchestrator Agent
 * The main coordinating agent that routes tasks to specialized agents
 */

const { BaseAgent } = require('./base-agent');
const getOrchestratorPrompt = require('./prompts/orchestrator');

/**
 * Create Orchestrator Agent instance
 * @param {Object} delegateTool - The delegate_agent tool created by registry
 * @returns {BaseAgent}
 */
function createOrchestratorAgent(delegateTool = { definitions: [], handlers: {} }) {
  return new BaseAgent({
    name: 'akira',
    displayName: 'Akira',
    description: 'Routes user requests to specialized agents and coordinates multi-agent tasks',
    systemPrompt: getOrchestratorPrompt(),
    toolDefinitions: delegateTool.definitions,
    toolHandlers: delegateTool.handlers
  });
}

module.exports = { createOrchestratorAgent };
