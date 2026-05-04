/**
 * Overlay Events Emitter
 * Central event system for tools to emit overlay events
 */

const { EventEmitter } = require('events');

// Create a singleton event emitter
const overlayEmitter = new EventEmitter();

/**
 * Emit an action event (mouse/keyboard)
 * @param {Object} action - Action details
 */
function emitAction(action) {
  overlayEmitter.emit('action', action);
}

/**
 * Emit a screenshot event
 * @param {Object|null} region - Screenshot region or null for fullscreen
 * @param {string} [label] - Label to display (e.g., "Searching...", "Verifying...")
 * @param {boolean} [animate] - Whether to animate (for expanding regions)
 */
function emitScreenshot(region = null, label = null, animate = false) {
  overlayEmitter.emit('screenshot', { region, fullscreen: !region, label, animate });
}

/**
 * Emit a tool indicator event
 * @param {Object} info - Tool info (name, status, success)
 */
function emitToolIndicator(info) {
  overlayEmitter.emit('tool', info);
}

/**
 * Emit agent active state
 * @param {boolean} active - Whether agent is active
 */
function emitAgentActive(active) {
  overlayEmitter.emit('agent', active);
}

/**
 * Listen for overlay events
 * @param {string} event - Event name
 * @param {Function} callback - Callback function
 */
function onOverlayEvent(event, callback) {
  overlayEmitter.on(event, callback);
}

/**
 * Remove listener
 * @param {string} event - Event name
 * @param {Function} callback - Callback function
 */
function offOverlayEvent(event, callback) {
  overlayEmitter.off(event, callback);
}

module.exports = {
  emitAction,
  emitScreenshot,
  emitToolIndicator,
  emitAgentActive,
  onOverlayEvent,
  offOverlayEvent,
  overlayEmitter
};
