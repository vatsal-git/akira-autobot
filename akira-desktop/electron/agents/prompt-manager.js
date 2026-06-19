/**
 * Prompt Manager
 * Handles runtime custom prompts retrieval, storage, and default rollbacks.
 */

const Store = require('electron-store');
const store = new Store({ name: 'akira-settings' });

// Default prompt functions mapped to agent names
const defaultPrompts = {
  akira: require('./prompts/orchestrator'),
  dobby: require('./prompts/file-agent'),
  vektor: require('./prompts/system-agent'),
  samba: require('./prompts/web-agent'),
  beneges: require('./prompts/desktop-agent')
};

/**
 * Get the current prompt for an agent (either user-overridden or default)
 * @param {string} agentName - Name of the agent
 * @returns {string} The prompt text
 */
function getPrompt(agentName) {
  const customPrompt = store.get(`agentPrompts.${agentName}`);
  if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim().length > 0) {
    return customPrompt;
  }

  const defaultPromptFn = defaultPrompts[agentName];
  if (defaultPromptFn) {
    return defaultPromptFn();
  }
  return '';
}

/**
 * Update and persist custom prompt for an agent, updating the active registry instance immediately
 * @param {string} agentName - Name of the agent
 * @param {string} promptText - The custom prompt text
 */
function updatePrompt(agentName, promptText) {
  store.set(`agentPrompts.${agentName}`, promptText);

  // Update active agent in registry if initialized
  try {
    const { getAgent } = require('./index');
    const agent = getAgent(agentName);
    if (agent) {
      agent.systemPrompt = promptText;
      console.log(`[prompt-manager] Updated active prompt in registry for: ${agentName}`);
    }
  } catch (error) {
    console.error(`[prompt-manager] Could not update active agent in registry:`, error.message);
  }
}

/**
 * Reset an agent's prompt to its default factory value
 * @param {string} agentName - Name of the agent
 * @returns {string} The default prompt text
 */
function resetPrompt(agentName) {
  store.delete(`agentPrompts.${agentName}`);

  const defaultPromptFn = defaultPrompts[agentName];
  const defaultPrompt = defaultPromptFn ? defaultPromptFn() : '';

  // Update active agent in registry if initialized
  try {
    const { getAgent } = require('./index');
    const agent = getAgent(agentName);
    if (agent) {
      agent.systemPrompt = defaultPrompt;
      console.log(`[prompt-manager] Reset active prompt in registry for: ${agentName}`);
    }
  } catch (error) {
    console.error(`[prompt-manager] Could not reset active agent in registry:`, error.message);
  }

  return defaultPrompt;
}

module.exports = {
  getPrompt,
  updatePrompt,
  resetPrompt
};
