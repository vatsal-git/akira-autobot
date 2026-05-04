/**
 * Message Parser
 * Parses user messages for agent tags (@agentname)
 */

/**
 * Parse a message for an agent tag at the start
 * Syntax: @agentname <message>
 *
 * @param {string} message - The user message to parse
 * @returns {{ tagged: boolean, agentName: string|null, message: string }}
 */
function parseAgentTag(message) {
  if (!message || typeof message !== 'string') {
    return { tagged: false, agentName: null, message: message || '' };
  }

  // Match @agentname at start, followed by whitespace and the rest of the message
  // The 's' flag allows . to match newlines
  const match = message.match(/^@(\w+)\s+(.+)$/s);

  if (!match) {
    return { tagged: false, agentName: null, message };
  }

  return {
    tagged: true,
    agentName: match[1].toLowerCase(),
    message: match[2].trim()
  };
}

/**
 * Check if an agent name is taggable (exists and is not akira)
 *
 * @param {string} agentName - Agent name to check (lowercase)
 * @param {Array<{name: string}>} availableAgents - List of available agents
 * @returns {boolean}
 */
function isTaggableAgent(agentName, availableAgents) {
  if (!agentName || agentName === 'akira') {
    return false;
  }
  return availableAgents.some(a => a.name === agentName);
}

/**
 * Get list of taggable agent names for error messages
 *
 * @param {Array<{name: string}>} availableAgents - List of available agents
 * @returns {string[]}
 */
function getTaggableAgentNames(availableAgents) {
  return availableAgents
    .filter(a => a.name !== 'akira')
    .map(a => `@${a.name}`);
}

module.exports = {
  parseAgentTag,
  isTaggableAgent,
  getTaggableAgentNames
};
