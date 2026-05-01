/**
 * Capability Registry
 * Query and lookup agent capabilities
 */

const { AGENT_CAPABILITIES, getAgentCapabilities } = require('./manifest');

/**
 * Find agents that can perform a specific action
 * @param {string} action - Action to search for (e.g., 'read', 'search', 'click')
 * @returns {Array<{name: string, capability: Object}>}
 */
function findAgentsByAction(action) {
  const results = [];

  for (const [agentName, manifest] of Object.entries(AGENT_CAPABILITIES)) {
    const matchingCapability = manifest.capabilities.find(
      cap => cap.action.toLowerCase() === action.toLowerCase()
    );

    if (matchingCapability) {
      results.push({
        name: agentName,
        displayName: manifest.displayName,
        capability: matchingCapability
      });
    }
  }

  return results;
}

/**
 * Find the best agent for a given task description
 * Uses keyword matching against bestFor and capabilities
 * @param {string} taskDescription - Description of the task
 * @returns {Array<{name: string, score: number, reason: string}>}
 */
function suggestAgentsForTask(taskDescription) {
  const task = taskDescription.toLowerCase();
  const scores = [];

  for (const [agentName, manifest] of Object.entries(AGENT_CAPABILITIES)) {
    let score = 0;
    const reasons = [];

    // Check bestFor matches
    for (const bestForItem of manifest.bestFor) {
      const keywords = bestForItem.toLowerCase().split(' ');
      for (const keyword of keywords) {
        if (keyword.length > 3 && task.includes(keyword)) {
          score += 2;
          reasons.push(`matches "${bestForItem}"`);
          break;
        }
      }
    }

    // Check capability descriptions
    for (const cap of manifest.capabilities) {
      if (task.includes(cap.action.toLowerCase())) {
        score += 3;
        reasons.push(`can "${cap.action}"`);
      }
      const descWords = cap.description.toLowerCase().split(' ');
      for (const word of descWords) {
        if (word.length > 4 && task.includes(word)) {
          score += 1;
          reasons.push(`capability: ${cap.action}`);
          break;
        }
      }
    }

    // Penalize if in notFor
    for (const notForItem of manifest.notFor) {
      const keywords = notForItem.toLowerCase().split(' ');
      for (const keyword of keywords) {
        if (keyword.length > 3 && task.includes(keyword)) {
          score -= 2;
          break;
        }
      }
    }

    if (score > 0) {
      scores.push({
        name: agentName,
        displayName: manifest.displayName,
        score,
        reason: [...new Set(reasons)].slice(0, 3).join(', ')
      });
    }
  }

  // Sort by score descending
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Get a summary of all agents for orchestrator context
 * @param {'brief' | 'full'} detail - Level of detail
 * @returns {string}
 */
function getAgentSummaryForPrompt(detail = 'brief') {
  const lines = [];

  for (const [agentName, manifest] of Object.entries(AGENT_CAPABILITIES)) {
    if (detail === 'brief') {
      lines.push(`• **${agentName}**: ${manifest.summary}`);
    } else {
      lines.push(`\n### ${manifest.displayName} (\`${agentName}\`)`);
      lines.push(manifest.summary);
      lines.push('\n**Can do:**');
      manifest.capabilities.forEach(cap => {
        lines.push(`- ${cap.action}: ${cap.description}`);
      });
      lines.push('\n**Cannot do:**');
      manifest.cannotDo.slice(0, 3).forEach(item => {
        lines.push(`- ${item}`);
      });
    }
  }

  return lines.join('\n');
}

/**
 * Get capability info formatted for list_agents tool response
 * @param {'summary' | 'full'} detail
 * @param {string} [filterAction] - Optional action to filter by
 * @returns {Array}
 */
function getAgentListForTool(detail = 'summary', filterAction = null) {
  const results = [];

  for (const [agentName, manifest] of Object.entries(AGENT_CAPABILITIES)) {
    // Filter by action if specified
    if (filterAction) {
      const hasAction = manifest.capabilities.some(
        cap => cap.action.toLowerCase() === filterAction.toLowerCase()
      );
      if (!hasAction) continue;
    }

    if (detail === 'summary') {
      results.push({
        name: agentName,
        displayName: manifest.displayName,
        summary: manifest.summary,
        actions: manifest.capabilities.map(c => c.action)
      });
    } else {
      results.push({
        name: agentName,
        displayName: manifest.displayName,
        summary: manifest.summary,
        capabilities: manifest.capabilities,
        cannotDo: manifest.cannotDo,
        bestFor: manifest.bestFor,
        notFor: manifest.notFor,
        exampleTasks: manifest.exampleTasks
      });
    }
  }

  return results;
}

/**
 * Check if an agent can perform a specific action
 * @param {string} agentName
 * @param {string} action
 * @returns {boolean}
 */
function canAgentDo(agentName, action) {
  const manifest = AGENT_CAPABILITIES[agentName];
  if (!manifest) return false;

  return manifest.capabilities.some(
    cap => cap.action.toLowerCase() === action.toLowerCase()
  );
}

/**
 * Get what an agent cannot do (for scope enforcement)
 * @param {string} agentName
 * @returns {string[]}
 */
function getAgentLimitations(agentName) {
  const manifest = AGENT_CAPABILITIES[agentName];
  if (!manifest) return [];

  return [...manifest.cannotDo];
}

/**
 * Validate if a task is appropriate for an agent
 * Returns warnings if task might be outside agent's capabilities
 * @param {string} agentName
 * @param {string} taskDescription
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateTaskForAgent(agentName, taskDescription) {
  const manifest = AGENT_CAPABILITIES[agentName];
  if (!manifest) {
    return { valid: false, warnings: [`Unknown agent: ${agentName}`] };
  }

  const task = taskDescription.toLowerCase();
  const warnings = [];

  // Check if task mentions things in notFor
  for (const notForItem of manifest.notFor) {
    const keywords = notForItem.toLowerCase().split(/\s+/);
    const significantKeywords = keywords.filter(k => k.length > 4);

    for (const keyword of significantKeywords) {
      if (task.includes(keyword)) {
        // Find which agent should handle this
        const suggestion = notForItem.match(/use (\w+) agent/i);
        if (suggestion) {
          warnings.push(`This task might be better for ${suggestion[1]} agent: "${notForItem}"`);
        } else {
          warnings.push(`Task may be outside scope: "${notForItem}"`);
        }
        break;
      }
    }
  }

  // Check if task mentions things in cannotDo
  for (const cannotItem of manifest.cannotDo) {
    const keywords = cannotItem.toLowerCase().split(/\s+/);
    const significantKeywords = keywords.filter(k => k.length > 4);

    for (const keyword of significantKeywords) {
      if (task.includes(keyword)) {
        warnings.push(`Agent cannot: "${cannotItem}"`);
        break;
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}

module.exports = {
  findAgentsByAction,
  suggestAgentsForTask,
  getAgentSummaryForPrompt,
  getAgentListForTool,
  canAgentDo,
  getAgentLimitations,
  validateTaskForAgent
};
