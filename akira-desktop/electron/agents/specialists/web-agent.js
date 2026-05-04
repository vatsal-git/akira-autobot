/**
 * Web Agent
 * Specialized agent for web search and content fetching
 */

const { BaseAgent } = require('../base-agent');
const getWebAgentPrompt = require('../prompts/web-agent');

// Import web tools
const webSearch = require('../../tools/web/web-search');
const fetchWebpage = require('../../tools/web/fetch-webpage');

/**
 * Create Web Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createWebAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine web tools with communication tools
  const toolDefinitions = [
    ...webSearch.definitions,
    ...fetchWebpage.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...webSearch.handlers,
    ...fetchWebpage.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'samba',
    displayName: 'Samba',
    description: 'Search the internet and fetch content from webpages',
    systemPrompt: getWebAgentPrompt(),
    toolDefinitions,
    toolHandlers
  });
}

module.exports = { createWebAgent };
