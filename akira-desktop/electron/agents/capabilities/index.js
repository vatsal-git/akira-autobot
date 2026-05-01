/**
 * Capabilities Module
 * Exports all capability-related utilities
 */

const manifest = require('./manifest');
const registry = require('./registry');

module.exports = {
  // Manifest
  AGENT_CAPABILITIES: manifest.AGENT_CAPABILITIES,
  getAgentCapabilities: manifest.getAgentCapabilities,
  getAllCapabilities: manifest.getAllCapabilities,
  getAgentNames: manifest.getAgentNames,

  // Registry queries
  findAgentsByAction: registry.findAgentsByAction,
  suggestAgentsForTask: registry.suggestAgentsForTask,
  getAgentSummaryForPrompt: registry.getAgentSummaryForPrompt,
  getAgentListForTool: registry.getAgentListForTool,
  canAgentDo: registry.canAgentDo,
  getAgentLimitations: registry.getAgentLimitations,
  validateTaskForAgent: registry.validateTaskForAgent
};
