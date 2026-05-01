/**
 * Clarification Routing
 * Handles agent requests for clarification with escalation logic
 */

const { EventEmitter } = require('events');

// Track clarification counts per task chain
const clarificationCounts = new Map();

// Event emitter for clarification events
const clarificationEmitter = new EventEmitter();

// Default clarification budget before escalating to user
const DEFAULT_CLARIFICATION_BUDGET = 2;

/**
 * Increment clarification count for a task chain
 * @param {string} taskId - Root task ID or parent task ID
 * @returns {number} New count
 */
function incrementClarificationCount(taskId) {
  const current = clarificationCounts.get(taskId) || 0;
  const newCount = current + 1;
  clarificationCounts.set(taskId, newCount);
  return newCount;
}

/**
 * Get clarification count for a task chain
 * @param {string} taskId
 * @returns {number}
 */
function getClarificationCount(taskId) {
  return clarificationCounts.get(taskId) || 0;
}

/**
 * Reset clarification count (after user responds)
 * @param {string} taskId
 */
function resetClarificationCount(taskId) {
  clarificationCounts.delete(taskId);
}

/**
 * Clear all clarification counts (e.g., on new conversation)
 */
function clearAllClarificationCounts() {
  clarificationCounts.clear();
}

// Pending clarification requests
const pendingClarifications = new Map();

/**
 * Request clarification from calling agent or user
 *
 * @param {Object} params
 * @param {string} params.question - What needs to be clarified
 * @param {string} params.whatIUnderstood - Agent's interpretation so far
 * @param {Array<{label: string, description?: string}>} [params.options] - Suggested options
 * @param {boolean} [params.canProceedWithDefault] - Can continue with default?
 * @param {string} [params.defaultChoice] - What to do if no response
 * @param {Object} params.taskMeta - Task metadata (fromAgent, parentTaskId, etc.)
 * @param {number} [params.clarificationBudget] - Max before escalating to user
 * @param {Function} [params.onEvent] - Event callback
 * @returns {Promise<{response: string, source: 'agent'|'user', selectedOption?: Object}>}
 */
async function requestClarification({
  question,
  whatIUnderstood,
  options = [],
  canProceedWithDefault = false,
  defaultChoice = null,
  taskMeta = {},
  clarificationBudget = DEFAULT_CLARIFICATION_BUDGET,
  onEvent = null
}) {
  const { fromAgent, parentTaskId, toAgent } = taskMeta;
  const trackingId = parentTaskId || `standalone_${Date.now()}`;

  // Check clarification count
  const count = incrementClarificationCount(trackingId);

  // Determine if should escalate to user
  const shouldEscalateToUser = count > clarificationBudget;

  if (shouldEscalateToUser) {
    // Escalate to user
    return await escalateToUser({
      question,
      whatIUnderstood,
      options,
      canProceedWithDefault,
      defaultChoice,
      fromAgent: toAgent,
      trackingId,
      onEvent
    });
  }

  // Ask calling agent
  return await askCallingAgent({
    question,
    whatIUnderstood,
    options,
    canProceedWithDefault,
    defaultChoice,
    toAgent: fromAgent,
    fromAgent: toAgent,
    trackingId,
    onEvent
  });
}

/**
 * Ask the calling agent for clarification
 * This returns a response that the calling agent should handle
 */
async function askCallingAgent({
  question,
  whatIUnderstood,
  options,
  canProceedWithDefault,
  defaultChoice,
  toAgent,
  fromAgent,
  trackingId,
  onEvent
}) {
  const clarificationData = {
    type: 'clarification_request',
    target: 'agent',
    toAgent,
    fromAgent,
    question,
    whatIUnderstood,
    options,
    canProceedWithDefault,
    defaultChoice,
    trackingId,
    timestamp: Date.now()
  };

  onEvent?.(clarificationData);
  clarificationEmitter.emit('request', clarificationData);

  // For agent-to-agent clarification, we return the request
  // The calling agent should respond through the normal tool call response
  return {
    needsClarification: true,
    question,
    whatIUnderstood,
    options,
    canProceedWithDefault,
    defaultChoice,
    source: 'agent',
    message: `Clarification needed: ${question}`
  };
}

/**
 * Escalate clarification request to user
 * Shows inline UI and waits for response
 */
async function escalateToUser({
  question,
  whatIUnderstood,
  options,
  canProceedWithDefault,
  defaultChoice,
  fromAgent,
  trackingId,
  onEvent
}) {
  const clarificationId = `clarify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const clarificationData = {
    type: 'clarification_needed',
    target: 'user',
    clarificationId,
    fromAgent,
    question,
    whatIUnderstood,
    options,
    canSkip: canProceedWithDefault,
    defaultAction: defaultChoice,
    trackingId,
    timestamp: Date.now()
  };

  onEvent?.(clarificationData);
  clarificationEmitter.emit('user_clarification', clarificationData);

  // Wait for user response
  const userResponse = await waitForUserClarification(clarificationId, canProceedWithDefault, defaultChoice);

  // Reset count after user responds
  resetClarificationCount(trackingId);

  return {
    response: userResponse.response,
    source: 'user',
    selectedOption: userResponse.selectedOption
  };
}

/**
 * Wait for user to respond to a clarification request
 */
function waitForUserClarification(clarificationId, canProceedWithDefault, defaultChoice) {
  return new Promise((resolve) => {
    pendingClarifications.set(clarificationId, resolve);

    // Timeout after 3 minutes
    setTimeout(() => {
      if (pendingClarifications.has(clarificationId)) {
        pendingClarifications.delete(clarificationId);

        if (canProceedWithDefault && defaultChoice) {
          resolve({
            response: defaultChoice,
            selectedOption: null,
            source: 'timeout_default'
          });
        } else {
          resolve({
            response: 'Request timed out - no response from user',
            selectedOption: null,
            source: 'timeout'
          });
        }
      }
    }, 3 * 60 * 1000);
  });
}

/**
 * Submit user response to a clarification request
 * Called from UI when user selects an option or types response
 *
 * @param {string} clarificationId - ID of the clarification request
 * @param {Object} response
 * @param {string} response.response - User's response text
 * @param {Object} [response.selectedOption] - If user selected from options
 */
function submitClarificationResponse(clarificationId, response) {
  const resolver = pendingClarifications.get(clarificationId);
  if (resolver) {
    pendingClarifications.delete(clarificationId);
    resolver(response);
    clarificationEmitter.emit('response', { clarificationId, ...response });
  }
}

/**
 * Check if there are pending clarification requests
 * @returns {boolean}
 */
function hasPendingClarifications() {
  return pendingClarifications.size > 0;
}

/**
 * Get count of pending clarifications
 * @returns {number}
 */
function getPendingClarificationCount() {
  return pendingClarifications.size;
}

/**
 * Subscribe to clarification events
 * @param {'request' | 'user_clarification' | 'response'} event
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
function onClarification(event, callback) {
  clarificationEmitter.on(event, callback);
  return () => clarificationEmitter.off(event, callback);
}

/**
 * Create the request_clarification tool definition for agents
 * @returns {Object} Tool definition and handler
 */
function createClarificationTool() {
  return {
    definition: {
      name: 'request_clarification',
      description: `Ask for clarification when the task is ambiguous or you're unsure how to proceed.

Routing behavior:
- First clarification goes to the calling agent
- If 2+ clarifications occur in the same task chain, escalates to user

Use this when:
- Task description is ambiguous
- Multiple valid interpretations exist
- You need specific details not provided
- Constraints in the task conflict with each other`,
      input_schema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Clear question about what you need clarified'
          },
          whatIUnderstood: {
            type: 'string',
            description: 'Your interpretation of the task so far - shows you made effort to understand'
          },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' }
              },
              required: ['label']
            },
            description: 'Suggested options if applicable (makes responding easier)'
          },
          canProceedWithDefault: {
            type: 'boolean',
            description: 'Can you continue with a reasonable default if no response?'
          },
          defaultChoice: {
            type: 'string',
            description: 'What you will do if canProceedWithDefault is true and no response comes'
          }
        },
        required: ['question', 'whatIUnderstood']
      }
    },

    handler: async (input, { taskMeta, clarificationBudget, onEvent }) => {
      return await requestClarification({
        ...input,
        taskMeta,
        clarificationBudget,
        onEvent
      });
    }
  };
}

module.exports = {
  DEFAULT_CLARIFICATION_BUDGET,
  requestClarification,
  submitClarificationResponse,
  hasPendingClarifications,
  getPendingClarificationCount,
  getClarificationCount,
  resetClarificationCount,
  clearAllClarificationCounts,
  onClarification,
  createClarificationTool
};
