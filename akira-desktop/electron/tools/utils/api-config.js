/**
 * Shared API Configuration
 * Stores the current API config so tools can make provider calls
 * Main.js should call setApiConfig when building the config
 */

let currentApiConfig = null;

/**
 * Set the current API configuration
 * Called from main.js when apiConfig is built
 * @param {Object} config - The apiConfig object
 */
function setApiConfig(config) {
  currentApiConfig = config;
}

/**
 * Get the current API configuration
 * @returns {Object|null} The current apiConfig or null if not set
 */
function getApiConfig() {
  return currentApiConfig;
}

/**
 * Check if API config is available
 * @returns {boolean}
 */
function hasApiConfig() {
  return currentApiConfig !== null &&
         (currentApiConfig.apiKey || currentApiConfig.credentials?.awsSecretAccessKey);
}

module.exports = {
  setApiConfig,
  getApiConfig,
  hasApiConfig
};
