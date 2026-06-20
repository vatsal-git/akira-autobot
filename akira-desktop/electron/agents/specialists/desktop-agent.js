/**
 * Desktop Agent
 * Specialized agent for desktop automation and UI interaction
 */

const { BaseAgent } = require('../base-agent');
const { getPrompt } = require('../prompt-manager');

// Import desktop automation tools
const desktopMouse = require('../../tools/desktop-automation/desktop-mouse');
const desktopKeyboard = require('../../tools/desktop-automation/desktop-keyboard');
const desktopScreenQuery = require('../../tools/desktop-automation/desktop-screen-query');
const desktopWait = require('../../tools/desktop-automation/desktop-wait');
const desktopDiagnose = require('../../tools/desktop-automation/desktop-diagnose');

// Import memory tools
const storeMemory = require('../../tools/memory/store-memory');
const searchMemories = require('../../tools/memory/search-memories');

// Import optional tools with error handling
let desktopSmartClick = { definitions: [], handlers: {} };
let desktopAnalyzeImage = { definitions: [], handlers: {} };
let windowsUiaTools = { definitions: [], handlers: {} };
let cameraTools = { definitions: [], handlers: {} };
let uiParseTools = { definitions: [], handlers: {} };

try {
  desktopSmartClick = require('../../tools/desktop-automation/desktop-smart-click');
} catch (e) {
  console.log('[desktop-agent] Smart click tools not available:', e.message);
}

try {
  desktopAnalyzeImage = require('../../tools/desktop-automation/desktop-analyze-image');
} catch (e) {
  console.log('[desktop-agent] Analyze image tools not available:', e.message);
}

try {
  windowsUiaTools = require('../../tools/desktop-automation/windows-uia-tools');
} catch (e) {
  console.log('[desktop-agent] Windows UIA tools not available');
}

try {
  cameraTools = require('../../tools/desktop-automation/camera-tools');
} catch (e) {
  console.log('[desktop-agent] Camera tools not available');
}

try {
  uiParseTools = require('../../tools/desktop-automation/ui-parse-tools');
} catch (e) {
  console.log('[desktop-agent] UI parse tools not available');
}

/**
 * Create Desktop Agent instance
 * @param {Object} communicationTools - Tools for inter-agent communication
 * @returns {BaseAgent}
 */
function createDesktopAgent(communicationTools = { definitions: [], handlers: {} }) {
  // Combine all desktop tools with communication tools and memory tools
  const toolDefinitions = [
    ...desktopMouse.definitions,
    ...desktopKeyboard.definitions,
    ...desktopScreenQuery.definitions,
    ...desktopWait.definitions,
    ...desktopDiagnose.definitions,
    ...desktopSmartClick.definitions,
    ...desktopAnalyzeImage.definitions,
    ...windowsUiaTools.definitions,
    ...cameraTools.definitions,
    ...uiParseTools.definitions,
    ...storeMemory.definitions,
    ...searchMemories.definitions,
    ...communicationTools.definitions
  ];

  const toolHandlers = {
    ...desktopMouse.handlers,
    ...desktopKeyboard.handlers,
    ...desktopScreenQuery.handlers,
    ...desktopWait.handlers,
    ...desktopDiagnose.handlers,
    ...desktopSmartClick.handlers,
    ...desktopAnalyzeImage.handlers,
    ...windowsUiaTools.handlers,
    ...cameraTools.handlers,
    ...uiParseTools.handlers,
    ...storeMemory.handlers,
    ...searchMemories.handlers,
    ...communicationTools.handlers
  };

  return new BaseAgent({
    name: 'beneges',
    displayName: 'BeneGes',
    description: 'Desktop automation: mouse, keyboard, screenshots, and UI interaction',
    systemPrompt: getPrompt('beneges'),
    toolDefinitions,
    toolHandlers
  });
}

module.exports = { createDesktopAgent };
