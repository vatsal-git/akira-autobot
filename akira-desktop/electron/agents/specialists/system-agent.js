/**
 * System Agent
 * Specialized agent for system commands and shell operations
 */

const { BaseAgent } = require('../base-agent');
const { getPrompt } = require('../prompt-manager');

// Import system tools
const executeCommand = require('../../tools/system/execute-command');
const reloadTools = require('../../tools/system/reload-tools');

// Import memory tools
const storeMemory = require('../../tools/memory/store-memory');
const searchMemories = require('../../tools/memory/search-memories');

/**
 * Create System Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createSystemAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine system tools with communication tools and memory tools
  const toolDefinitions = [
    ...executeCommand.definitions,
    ...reloadTools.definitions,
    ...storeMemory.definitions,
    ...searchMemories.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...executeCommand.handlers,
    ...reloadTools.handlers,
    ...storeMemory.handlers,
    ...searchMemories.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'vektor',
    displayName: 'Vektor',
    description: 'Execute shell commands and system operations',
    systemPrompt: getPrompt('vektor'),
    toolDefinitions,
    toolHandlers
  });
}

module.exports = { createSystemAgent };
