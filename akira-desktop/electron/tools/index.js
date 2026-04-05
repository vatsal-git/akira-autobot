/**
 * Akira Desktop Tools - Index
 * Exports tool definitions and handlers
 */

const fileTools = require('./file-tools');
const systemTools = require('./system-tools');
const webTools = require('./web-tools');
const memoryTools = require('./memory-tools');
const desktopTools = require('./desktop-tools');
const uiParseTools = require('./ui-parse-tools');
const windowsUiaTools = require('./windows-uia-tools');
const cameraTools = require('./camera-tools');

// Combine all tool definitions
const TOOL_DEFINITIONS = [
  ...fileTools.definitions,
  ...systemTools.definitions,
  ...webTools.definitions,
  ...memoryTools.definitions,
  ...desktopTools.definitions,
  ...uiParseTools.definitions,
  ...windowsUiaTools.definitions,
  ...cameraTools.definitions,
];

// Combine all handlers
const TOOL_HANDLERS = {
  ...fileTools.handlers,
  ...systemTools.handlers,
  ...webTools.handlers,
  ...memoryTools.handlers,
  ...desktopTools.handlers,
  ...uiParseTools.handlers,
  ...windowsUiaTools.handlers,
  ...cameraTools.handlers,
};

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {object} input - Tool input parameters
 * @returns {Promise<{success: boolean, result: any, error?: string}>}
 */
async function executeTool(name, input) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    const result = await handler(input);
    return { success: true, result };
  } catch (error) {
    console.error(`Tool ${name} failed:`, error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get tool definitions in OpenRouter/OpenAI format
 */
function getToolsForAPI() {
  return TOOL_DEFINITIONS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/**
 * Set workspace root for file tools
 */
function setWorkspaceRoot(root) {
  fileTools.setWorkspaceRoot(root);
}

/**
 * Set reload callback for reload_tools
 */
function setReloadCallback(callback) {
  systemTools.setReloadCallback(callback);
}

module.exports = {
  TOOL_DEFINITIONS,
  TOOL_HANDLERS,
  executeTool,
  getToolsForAPI,
  setWorkspaceRoot,
  setReloadCallback,
};
