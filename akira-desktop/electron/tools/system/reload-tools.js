/**
 * Reload Tools Tool
 * reload_tools - Reload tools from the tools directory
 */

// Reload callback - will be set by the main process
let reloadCallback = null;

function setReloadCallback(callback) {
  reloadCallback = callback;
}

const definitions = [
  {
    name: 'reload_tools',
    description: 'Reload tools from the tools directory. Call this after creating or editing a tool module so Akira can use the new or updated tool without restarting.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

const handlers = {
  async reload_tools(input) {
    if (!reloadCallback) {
      return {
        success: false,
        error: 'Reload not available (no callback configured).',
      };
    }

    try {
      await reloadCallback();
      return {
        success: true,
        message: 'Tools reloaded. New tools are now available.',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  },
};

module.exports = { definitions, handlers, setReloadCallback };
