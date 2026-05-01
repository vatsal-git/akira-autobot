/**
 * Memory Agent
 * Specialized agent for long-term memory management
 */

const { BaseAgent } = require('../base-agent');
const getMemoryAgentPrompt = require('../prompts/memory-agent');

// Import memory tools
const storeMemory = require('../../tools/memory/store-memory');
const searchMemories = require('../../tools/memory/search-memories');
const listMemories = require('../../tools/memory/list-memories');
const deleteMemory = require('../../tools/memory/delete-memory');
const updateMemory = require('../../tools/memory/update-memory');

/**
 * Create Memory Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createMemoryAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine memory tools with communication tools
  const toolDefinitions = [
    ...storeMemory.definitions,
    ...searchMemories.definitions,
    ...listMemories.definitions,
    ...deleteMemory.definitions,
    ...updateMemory.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...storeMemory.handlers,
    ...searchMemories.handlers,
    ...listMemories.handlers,
    ...deleteMemory.handlers,
    ...updateMemory.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'smriti',
    displayName: 'Smriti',
    description: 'Store, search, and manage long-term memories',
    systemPrompt: getMemoryAgentPrompt(),
    toolDefinitions,
    toolHandlers
  });
}

module.exports = { createMemoryAgent };
