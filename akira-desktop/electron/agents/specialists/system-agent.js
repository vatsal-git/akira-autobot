/**
 * System Agent
 * Specialized agent for system commands and shell operations
 */

const { BaseAgent } = require('../base-agent');
const getSystemAgentPrompt = require('../prompts/system-agent');

// Import system tools
const executeCommand = require('../../tools/system/execute-command');
const reloadTools = require('../../tools/system/reload-tools');

/**
 * Create System Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createSystemAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine system tools with communication tools
  const toolDefinitions = [
    ...executeCommand.definitions,
    ...reloadTools.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...executeCommand.handlers,
    ...reloadTools.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'vektor',
    displayName: 'Vektor',
    description: 'Execute shell commands and system operations',
    systemPrompt: getSystemAgentPrompt(),
    toolDefinitions,
    toolHandlers
  });
}

module.exports = { createSystemAgent };
