/**
 * Emergency Stop Handler
 * Provides a hard stop mechanism available to all agents
 */

const { EventEmitter } = require('events');

// Global emergency state
let emergencyState = {
  stopped: false,
  reason: null,
  severity: null,
  triggeredBy: null,
  timestamp: null,
  pendingUserResponse: false,
  userResponseCallback: null
};

// Event emitter for emergency events
const emergencyEmitter = new EventEmitter();

/**
 * Severity levels for emergency stops
 */
const SEVERITY = {
  WARNING: 'warning',   // Caution - user should be aware
  ERROR: 'error',       // Problem occurred - needs attention
  CRITICAL: 'critical'  // Immediate attention required
};

/**
 * Trigger an emergency stop
 * Cancels all pending tasks and alerts the user
 *
 * @param {Object} params
 * @param {string} params.reason - Why the emergency stop was triggered
 * @param {string} params.severity - 'warning' | 'error' | 'critical'
 * @param {boolean} params.requiresUserInput - Must user respond before continuing?
 * @param {string[]} [params.suggestedActions] - Options for user to choose
 * @param {string} [params.context] - What was happening when stopped
 * @param {string} [params.triggeredBy] - Agent that triggered the stop
 * @param {Function} [params.onEvent] - Event callback for UI updates
 * @returns {Promise<Object>} Result including user response if required
 */
async function triggerEmergencyStop({
  reason,
  severity = SEVERITY.ERROR,
  requiresUserInput = false,
  suggestedActions = ['Continue', 'Abort'],
  context = '',
  triggeredBy = 'unknown',
  onEvent = null
}) {
  // Update global state
  emergencyState = {
    stopped: true,
    reason,
    severity,
    triggeredBy,
    timestamp: Date.now(),
    pendingUserResponse: requiresUserInput,
    userResponseCallback: null
  };

  // Emit emergency event for UI
  const eventData = {
    type: 'emergency_stop',
    severity,
    reason,
    context,
    triggeredBy,
    suggestedActions,
    requiresResponse: requiresUserInput,
    timestamp: emergencyState.timestamp
  };

  emergencyEmitter.emit('emergency', eventData);
  onEvent?.(eventData);

  console.error(`[EMERGENCY STOP] Severity: ${severity}, Reason: ${reason}, By: ${triggeredBy}`);

  // If requires user input, wait for response
  if (requiresUserInput) {
    const userResponse = await waitForUserResponse();

    emergencyState.pendingUserResponse = false;

    return {
      success: true,
      stopped: true,
      userResponse,
      canResume: userResponse.action !== 'Abort'
    };
  }

  return {
    success: true,
    stopped: true,
    canResume: false
  };
}

/**
 * Wait for user response to emergency stop
 * @returns {Promise<{action: string, notes?: string}>}
 */
function waitForUserResponse() {
  return new Promise((resolve) => {
    emergencyState.userResponseCallback = resolve;

    // Timeout after 5 minutes - default to abort
    setTimeout(() => {
      if (emergencyState.userResponseCallback === resolve) {
        resolve({ action: 'Abort', reason: 'Timeout - no user response' });
        emergencyState.userResponseCallback = null;
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * Submit user response to pending emergency stop
 * Called from UI when user clicks an action button
 *
 * @param {Object} response
 * @param {string} response.action - The action user selected
 * @param {string} [response.notes] - Additional notes from user
 */
function submitUserResponse(response) {
  if (emergencyState.userResponseCallback) {
    emergencyState.userResponseCallback(response);
    emergencyState.userResponseCallback = null;
  }
}

/**
 * Check if emergency stop is currently active
 * @returns {boolean}
 */
function isEmergencyStopped() {
  return emergencyState.stopped;
}

/**
 * Check if waiting for user response
 * @returns {boolean}
 */
function isPendingUserResponse() {
  return emergencyState.pendingUserResponse;
}

/**
 * Get current emergency state
 * @returns {Object}
 */
function getEmergencyState() {
  return { ...emergencyState };
}

/**
 * Clear emergency state (after user response or manual clear)
 */
function clearEmergencyState() {
  emergencyState = {
    stopped: false,
    reason: null,
    severity: null,
    triggeredBy: null,
    timestamp: null,
    pendingUserResponse: false,
    userResponseCallback: null
  };

  emergencyEmitter.emit('cleared');
}

/**
 * Subscribe to emergency events
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
function onEmergency(callback) {
  emergencyEmitter.on('emergency', callback);
  return () => emergencyEmitter.off('emergency', callback);
}

/**
 * Subscribe to emergency cleared events
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
function onEmergencyCleared(callback) {
  emergencyEmitter.on('cleared', callback);
  return () => emergencyEmitter.off('cleared', callback);
}

/**
 * Create the emergency_stop tool definition for agents
 * @returns {Object} Tool definition
 */
function createEmergencyStopTool() {
  return {
    definition: {
      name: 'emergency_stop',
      description: `Immediately halt all task execution and alert the user. Use when:
- Human decision or input is absolutely required to proceed
- Potentially dangerous or irreversible operation detected
- Unrecoverable error that could affect other tasks
- Ethical or safety concern
- Task is going in wrong direction and needs user course-correction

This will cancel all pending async tasks and show an inline alert to the user.
The user can then choose how to proceed.`,
      input_schema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Clear explanation of why you are stopping all execution'
          },
          severity: {
            type: 'string',
            enum: ['warning', 'error', 'critical'],
            description: 'warning: caution/heads-up, error: problem needs attention, critical: immediate action required'
          },
          requiresUserInput: {
            type: 'boolean',
            description: 'If true, all execution pauses until user responds. Use true when you cannot proceed without user decision.'
          },
          suggestedActions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Options for user to choose from (e.g., ["Continue anyway", "Abort", "Modify and retry"])'
          },
          context: {
            type: 'string',
            description: 'What was happening when you decided to stop - helps user understand the situation'
          }
        },
        required: ['reason', 'severity', 'requiresUserInput']
      }
    },

    handler: async (input, { agentName, onEvent, cancelPendingTasks }) => {
      // Cancel any pending async tasks
      if (cancelPendingTasks) {
        await cancelPendingTasks();
      }

      return await triggerEmergencyStop({
        ...input,
        triggeredBy: agentName,
        onEvent
      });
    }
  };
}

module.exports = {
  SEVERITY,
  triggerEmergencyStop,
  submitUserResponse,
  isEmergencyStopped,
  isPendingUserResponse,
  getEmergencyState,
  clearEmergencyState,
  onEmergency,
  onEmergencyCleared,
  createEmergencyStopTool
};
