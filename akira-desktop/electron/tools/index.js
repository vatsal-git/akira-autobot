/**
 * Akira Desktop Tools - Dynamic Loader
 * Automatically discovers and loads tools from category folders
 */

const fs = require('fs');
const path = require('path');

const TOOLS_DIR = __dirname;

// Categories to scan (in order)
const TOOL_CATEGORIES = [
  'file-operations',
  'system',
  'web',
  'memory',
  'desktop-automation',
];

// Folders to skip (not tool categories)
const SKIP_FOLDERS = ['utils', 'node_modules'];

// Storage for loaded tools
let TOOL_DEFINITIONS = [];
let TOOL_HANDLERS = {};
let loadedModules = new Map(); // path -> module

// Special modules that need setup callbacks
let workspaceSetters = [];
let reloadCallback = null;

/**
 * Load a single tool module
 */
function loadToolModule(filePath) {
  try {
    // Clear require cache to allow hot reloading
    delete require.cache[require.resolve(filePath)];

    const module = require(filePath);

    if (!module.definitions || !module.handlers) {
      console.warn(`[tools] Skipping ${filePath}: missing definitions or handlers`);
      return null;
    }

    // Track modules with setWorkspaceRoot
    if (typeof module.setWorkspaceRoot === 'function') {
      workspaceSetters.push(module.setWorkspaceRoot);
    }

    // Track reload callback setter
    if (typeof module.setReloadCallback === 'function') {
      module.setReloadCallback(reloadCallback);
    }

    loadedModules.set(filePath, module);
    return module;
  } catch (error) {
    console.error(`[tools] Failed to load ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Scan a category folder and load all tool modules
 */
function loadCategoryTools(categoryPath) {
  const definitions = [];
  const handlers = {};

  if (!fs.existsSync(categoryPath)) {
    return { definitions, handlers };
  }

  const files = fs.readdirSync(categoryPath);

  for (const file of files) {
    if (!file.endsWith('.js')) continue;

    const filePath = path.join(categoryPath, file);
    const stats = fs.statSync(filePath);

    if (!stats.isFile()) continue;

    const module = loadToolModule(filePath);
    if (!module) continue;

    // Add definitions and handlers
    definitions.push(...module.definitions);
    Object.assign(handlers, module.handlers);
  }

  return { definitions, handlers };
}

/**
 * Discover and load all tools from category folders
 */
function discoverTools() {
  const allDefinitions = [];
  const allHandlers = {};

  // Reset trackers
  workspaceSetters = [];
  loadedModules.clear();

  // First, load from known categories
  for (const category of TOOL_CATEGORIES) {
    const categoryPath = path.join(TOOLS_DIR, category);
    const { definitions, handlers } = loadCategoryTools(categoryPath);
    allDefinitions.push(...definitions);
    Object.assign(allHandlers, handlers);
  }

  // Then, discover any new category folders
  const entries = fs.readdirSync(TOOLS_DIR);
  for (const entry of entries) {
    // Skip known categories (already loaded)
    if (TOOL_CATEGORIES.includes(entry)) continue;

    // Skip non-directories and special folders
    if (SKIP_FOLDERS.includes(entry)) continue;
    if (entry.startsWith('.')) continue;

    const entryPath = path.join(TOOLS_DIR, entry);
    const stats = fs.statSync(entryPath);

    if (!stats.isDirectory()) continue;

    // Load tools from this new category
    console.log(`[tools] Discovered new category: ${entry}`);
    const { definitions, handlers } = loadCategoryTools(entryPath);
    allDefinitions.push(...definitions);
    Object.assign(allHandlers, handlers);
  }

  return { definitions: allDefinitions, handlers: allHandlers };
}

/**
 * Initial load of all tools
 */
function loadAllTools() {
  const { definitions, handlers } = discoverTools();
  TOOL_DEFINITIONS = definitions;
  TOOL_HANDLERS = handlers;

  console.log(`[tools] Loaded ${TOOL_DEFINITIONS.length} tools from ${loadedModules.size} modules`);

  return { definitions: TOOL_DEFINITIONS, handlers: TOOL_HANDLERS };
}

/**
 * Reload all tools (for hot reloading)
 */
function reloadAllTools() {
  console.log('[tools] Reloading all tools...');

  // Store current reload callback
  const currentCallback = reloadCallback;

  // Reload everything
  const { definitions, handlers } = discoverTools();
  TOOL_DEFINITIONS = definitions;
  TOOL_HANDLERS = handlers;

  // Restore reload callback to new modules
  reloadCallback = currentCallback;
  for (const [filePath, module] of loadedModules) {
    if (typeof module.setReloadCallback === 'function') {
      module.setReloadCallback(reloadCallback);
    }
  }

  console.log(`[tools] Reloaded ${TOOL_DEFINITIONS.length} tools from ${loadedModules.size} modules`);

  return { definitions: TOOL_DEFINITIONS, handlers: TOOL_HANDLERS };
}

// Initial load
loadAllTools();

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
 * @param {string[]} disabledTools - Array of tool names to exclude
 */
function getToolsForAPI(disabledTools = []) {
  return TOOL_DEFINITIONS
    .filter(tool => !disabledTools.includes(tool.name))
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
}

/**
 * Get tools organized by category for UI display
 * Returns { category: [{ name, description }, ...], ... }
 */
function getToolsWithCategories() {
  const result = {};

  for (const [filePath, module] of loadedModules) {
    const relPath = path.relative(TOOLS_DIR, filePath);
    const parts = relPath.split(path.sep);
    const category = parts.length > 1 ? parts[0] : 'uncategorized';

    if (!result[category]) {
      result[category] = [];
    }

    for (const def of module.definitions) {
      result[category].push({
        name: def.name,
        description: def.description
      });
    }
  }

  return result;
}

/**
 * Set workspace root for file tools
 */
function setWorkspaceRoot(root) {
  for (const setter of workspaceSetters) {
    try {
      setter(root);
    } catch (e) {
      console.error('[tools] Failed to set workspace root:', e.message);
    }
  }
}

/**
 * Set reload callback for reload_tools
 */
function setReloadCallback(callback) {
  reloadCallback = callback;

  // Update any already-loaded reload modules
  for (const [filePath, module] of loadedModules) {
    if (typeof module.setReloadCallback === 'function') {
      module.setReloadCallback(callback);
    }
  }
}

/**
 * Get list of loaded tool names
 */
function getToolNames() {
  return TOOL_DEFINITIONS.map(t => t.name);
}

/**
 * Get tool categories and their tools
 */
function getToolCategories() {
  const categories = {};

  for (const [filePath, module] of loadedModules) {
    const relPath = path.relative(TOOLS_DIR, filePath);
    const parts = relPath.split(path.sep);
    const category = parts.length > 1 ? parts[0] : 'uncategorized';

    if (!categories[category]) {
      categories[category] = [];
    }

    for (const def of module.definitions) {
      categories[category].push(def.name);
    }
  }

  return categories;
}

module.exports = {
  // Core exports
  TOOL_DEFINITIONS,
  TOOL_HANDLERS,
  executeTool,
  getToolsForAPI,

  // Setup functions
  setWorkspaceRoot,
  setReloadCallback,

  // Reload/discovery
  reloadAllTools,
  loadAllTools,

  // Introspection
  getToolNames,
  getToolCategories,
  getToolsWithCategories,
};
