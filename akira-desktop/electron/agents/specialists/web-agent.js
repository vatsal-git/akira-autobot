/**
 * Web Agent
 * Specialized agent for web search and content fetching
 */

const { BaseAgent } = require('../base-agent');
const { getPrompt } = require('../prompt-manager');

// Import web tools
const webSearch = require('../../tools/web/web-search');
const fetchWebpage = require('../../tools/web/fetch-webpage');

// Import memory tools
const storeMemory = require('../../tools/memory/store-memory');
const searchMemories = require('../../tools/memory/search-memories');

/**
 * Create Web Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createWebAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine web tools with communication tools and memory tools
  const toolDefinitions = [
    ...webSearch.definitions,
    ...fetchWebpage.definitions,
    ...storeMemory.definitions,
    ...searchMemories.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...webSearch.handlers,
    ...fetchWebpage.handlers,
    ...storeMemory.handlers,
    ...searchMemories.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'samba',
    displayName: 'Samba',
    description: 'Search the internet and fetch content from webpages',
    systemPrompt: getPrompt('samba'),
    toolDefinitions,
    toolHandlers
  });
}

module.exports = { createWebAgent };
