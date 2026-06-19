/**
 * Orchestrator Agent
 * The main coordinating agent that routes tasks to specialized agents
 */

const { BaseAgent } = require('./base-agent');
const { getPrompt } = require('./prompt-manager');

// Import memory tools
const storeMemory = require('../tools/memory/store-memory');
const searchMemories = require('../tools/memory/search-memories');
const listMemories = require('../tools/memory/list-memories');
const deleteMemory = require('../tools/memory/delete-memory');
const updateMemory = require('../tools/memory/update-memory');

/**
 * Create Orchestrator Agent instance
 * @param {Object} delegateTool - The delegate_agent tool created by registry
 * @returns {BaseAgent}
 */
function createOrchestratorAgent(delegateTool = { definitions: [], handlers: {} }) {
  // Combine memory tools with delegate tool definitions & handlers
  const definitions = [
    ...storeMemory.definitions,
    ...searchMemories.definitions,
    ...listMemories.definitions,
    ...deleteMemory.definitions,
    ...updateMemory.definitions,
    ...(delegateTool.definitions || [])
  ];

  const handlers = {
    ...storeMemory.handlers,
    ...searchMemories.handlers,
    ...listMemories.handlers,
    ...deleteMemory.handlers,
    ...updateMemory.handlers,
    ...(delegateTool.handlers || {})
  };

  return new BaseAgent({
    name: 'akira',
    displayName: 'Akira',
    description: 'Routes user requests to specialized agents and coordinates multi-agent tasks',
    systemPrompt: getPrompt('akira'),
    toolDefinitions: definitions,
    toolHandlers: handlers
  });
}

module.exports = { createOrchestratorAgent };
