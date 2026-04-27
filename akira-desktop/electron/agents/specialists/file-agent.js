/**
 * File Agent
 * Specialized agent for file system operations
 */

const { BaseAgent } = require('../base-agent');
const getFileAgentPrompt = require('../prompts/file-agent');

// Import file operation tools
const readFile = require('../../tools/file-operations/read-file');
const writeFile = require('../../tools/file-operations/write-file');
const patchFile = require('../../tools/file-operations/patch-file');
const listDir = require('../../tools/file-operations/list-dir');

/**
 * Create File Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createFileAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine file tools with communication tools
  const toolDefinitions = [
    ...readFile.definitions,
    ...writeFile.definitions,
    ...patchFile.definitions,
    ...listDir.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...readFile.handlers,
    ...writeFile.handlers,
    ...patchFile.handlers,
    ...listDir.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'file',
    displayName: 'File Agent',
    description: 'File system operations: reading, writing, patching files, and listing directories',
    systemPrompt: getFileAgentPrompt(),
    toolDefinitions,
    toolHandlers
  });
}

// Export workspace root setter for all file tools
function setWorkspaceRoot(root) {
  if (readFile.setWorkspaceRoot) readFile.setWorkspaceRoot(root);
  if (writeFile.setWorkspaceRoot) writeFile.setWorkspaceRoot(root);
  if (patchFile.setWorkspaceRoot) patchFile.setWorkspaceRoot(root);
  if (listDir.setWorkspaceRoot) listDir.setWorkspaceRoot(root);
}

module.exports = { createFileAgent, setWorkspaceRoot };
