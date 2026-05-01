/**
 * Control Module
 * Emergency stop and clarification handling for agents
 */

const emergencyStop = require('./emergency-stop');
const clarification = require('./clarification');

module.exports = {
  // Emergency Stop
  SEVERITY: emergencyStop.SEVERITY,
  triggerEmergencyStop: emergencyStop.triggerEmergencyStop,
  submitUserResponse: emergencyStop.submitUserResponse,
  isEmergencyStopped: emergencyStop.isEmergencyStopped,
  isPendingUserResponse: emergencyStop.isPendingUserResponse,
  getEmergencyState: emergencyStop.getEmergencyState,
  clearEmergencyState: emergencyStop.clearEmergencyState,
  onEmergency: emergencyStop.onEmergency,
  onEmergencyCleared: emergencyStop.onEmergencyCleared,
  createEmergencyStopTool: emergencyStop.createEmergencyStopTool,

  // Clarification
  DEFAULT_CLARIFICATION_BUDGET: clarification.DEFAULT_CLARIFICATION_BUDGET,
  requestClarification: clarification.requestClarification,
  submitClarificationResponse: clarification.submitClarificationResponse,
  hasPendingClarifications: clarification.hasPendingClarifications,
  getPendingClarificationCount: clarification.getPendingClarificationCount,
  getClarificationCount: clarification.getClarificationCount,
  resetClarificationCount: clarification.resetClarificationCount,
  clearAllClarificationCounts: clarification.clearAllClarificationCounts,
  onClarification: clarification.onClarification,
  createClarificationTool: clarification.createClarificationTool
};
