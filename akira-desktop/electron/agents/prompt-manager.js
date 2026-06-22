/**
 * Prompt Manager
 * Handles runtime custom prompts retrieval, storage, and default rollbacks.
 */

const Store = require('electron-store');
const store = new Store({ name: 'akira-settings' });
const { getThinkingInstructions } = require('./prompts/shared');

// Default prompt functions mapped to agent names
const defaultPrompts = {
  akira: require('./prompts/orchestrator'),
  dobby: require('./prompts/file-agent'),
  vektor: require('./prompts/system-agent'),
  samba: require('./prompts/web-agent'),
  beneges: require('./prompts/desktop-agent')
};

// Valid thinking levels
const THINKING_LEVELS = ['quick', 'normal', 'deep'];
const DEFAULT_THINKING_LEVEL = 'normal';

/**
 * Get the thinking level for an agent
 * @param {string} agentName - Name of the agent
 * @returns {string} The thinking level ('quick' | 'normal' | 'deep')
 */
function getThinkingLevel(agentName) {
  const level = store.get(`agentThinkingLevels.${agentName}`);
  if (level && THINKING_LEVELS.includes(level)) {
    return level;
  }
  return DEFAULT_THINKING_LEVEL;
}

/**
 * Set the thinking level for an agent
 * @param {string} agentName - Name of the agent
 * @param {string} level - The thinking level ('quick' | 'normal' | 'deep')
 */
function setThinkingLevel(agentName, level) {
  if (!THINKING_LEVELS.includes(level)) {
    level = DEFAULT_THINKING_LEVEL;
  }
  store.set(`agentThinkingLevels.${agentName}`, level);

  // Update active agent in registry if initialized
  try {
    const { getAgent } = require('./index');
    const agent = getAgent(agentName);
    if (agent) {
      // Rebuild prompt with new thinking level
      agent.systemPrompt = getPrompt(agentName);
      console.log(`[prompt-manager] Updated thinking level for: ${agentName} to ${level}`);
    }
  } catch (error) {
    console.error(`[prompt-manager] Could not update active agent thinking level:`, error.message);
  }
}

/**
 * Get the current prompt for an agent (either user-overridden or default)
 * Prepends thinking instructions based on the agent's thinking level
 * @param {string} agentName - Name of the agent
 * @returns {string} The prompt text
 */
function getPrompt(agentName) {
  let basePrompt;

  const customPrompt = store.get(`agentPrompts.${agentName}`);
  if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim().length > 0) {
    basePrompt = customPrompt;
  } else {
    const defaultPromptFn = defaultPrompts[agentName];
    if (defaultPromptFn) {
      basePrompt = defaultPromptFn();
    } else {
      return '';
    }
  }

  // Prepend thinking instructions
  const thinkingLevel = getThinkingLevel(agentName);
  const thinkingInstructions = getThinkingInstructions(thinkingLevel);

  return `${thinkingInstructions}\n\n${basePrompt}`;
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
      // Rebuild full prompt with thinking instructions
      agent.systemPrompt = getPrompt(agentName);
      console.log(`[prompt-manager] Updated active prompt in registry for: ${agentName}`);
    }
  } catch (error) {
    console.error(`[prompt-manager] Could not update active agent in registry:`, error.message);
  }
}

/**
 * Reset an agent's prompt to its default factory value
 * @param {string} agentName - Name of the agent
 * @returns {string} The full prompt text (with thinking instructions)
 */
function resetPrompt(agentName) {
  store.delete(`agentPrompts.${agentName}`);

  // Update active agent in registry if initialized
  try {
    const { getAgent } = require('./index');
    const agent = getAgent(agentName);
    if (agent) {
      // Rebuild full prompt with thinking instructions
      agent.systemPrompt = getPrompt(agentName);
      console.log(`[prompt-manager] Reset active prompt in registry for: ${agentName}`);
    }
  } catch (error) {
    console.error(`[prompt-manager] Could not reset active agent in registry:`, error.message);
  }

  // Return the full prompt (with thinking instructions)
  return getPrompt(agentName);
}

module.exports = {
  getPrompt,
  updatePrompt,
  resetPrompt,
  getThinkingLevel,
  setThinkingLevel,
  THINKING_LEVELS
};
