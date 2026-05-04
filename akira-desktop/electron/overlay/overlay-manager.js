/**
 * Overlay Manager
 * Manages a transparent fullscreen overlay window for visual feedback
 * during desktop automation actions
 */

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let overlayWindow = null;
let isAgentActive = false;

/**
 * Create the overlay window
 * @param {boolean} isDev - Whether running in development mode
 */
function createOverlayWindow(isDev = false) {
  if (overlayWindow) {
    return overlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: width,
    height: height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: true,
    fullscreen: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Make window click-through
  overlayWindow.setIgnoreMouseEvents(true);

  // Set as tool window (doesn't show in taskbar/alt-tab on Windows)
  // Use 'screen-saver' level (highest z-order) to ensure overlay appears above the Windows taskbar
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Ensure fullscreen mode covers taskbar on Windows
  overlayWindow.setFullScreen(true);

  // Load overlay HTML
  if (isDev) {
    overlayWindow.loadURL('http://localhost:1420/overlay.html');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../../dist/overlay.html'));
  }

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  // Handle display changes (resize overlay)
  screen.on('display-metrics-changed', () => {
    if (overlayWindow) {
      const display = screen.getPrimaryDisplay();
      overlayWindow.setBounds({
        x: 0,
        y: 0,
        width: display.bounds.width,
        height: display.bounds.height
      });
    }
  });

  return overlayWindow;
}

/**
 * Show/hide the agent active border
 * @param {boolean} active - Whether agent is actively working
 */
function showAgentActive(active) {
  isAgentActive = active;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-border', {
      type: 'agent',
      active
    });
  }
}

/**
 * Show an action indicator
 * @param {Object} action - Action details
 * @param {string} action.type - Action type: 'click', 'move', 'type', 'key', 'scroll', 'drag'
 * @param {number} [action.x] - X coordinate (for mouse actions)
 * @param {number} [action.y] - Y coordinate (for mouse actions)
 * @param {string} [action.text] - Text content (for type/key actions)
 * @param {string} [action.button] - Mouse button (for click actions)
 * @param {number} [action.amount] - Scroll amount (for scroll actions)
 */
function showAction(action) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-action', action);
  }
}

/**
 * Show screenshot region indicator
 * @param {Object} region - Screenshot region (null for fullscreen)
 * @param {number} [region.left] - Left coordinate
 * @param {number} [region.top] - Top coordinate
 * @param {number} [region.width] - Width
 * @param {number} [region.height] - Height
 * @param {string} [label] - Label to display
 * @param {boolean} [animate] - Whether to animate expansion
 */
function showScreenshot(region = null, label = null, animate = false) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-screenshot', {
      region,
      fullscreen: !region,
      label,
      animate
    });
  }
}

/**
 * Show tool execution indicator
 * @param {Object} info - Tool info
 * @param {string} info.name - Tool name
 * @param {string} info.status - 'start' or 'complete'
 * @param {boolean} [info.success] - Whether tool succeeded (for complete status)
 */
function showToolIndicator(info) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-tool', info);
  }
}

/**
 * Hide all overlay elements
 */
function hideAll() {
  isAgentActive = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-hide-all');
  }
}

/**
 * Destroy the overlay window
 */
function destroy() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
}

/**
 * Check if overlay is ready
 * @returns {boolean}
 */
function isReady() {
  return overlayWindow && !overlayWindow.isDestroyed();
}

/**
 * Get overlay window instance
 * @returns {BrowserWindow|null}
 */
function getWindow() {
  return overlayWindow;
}

module.exports = {
  createOverlayWindow,
  showAgentActive,
  showAction,
  showScreenshot,
  showToolIndicator,
  hideAll,
  destroy,
  isReady,
  getWindow
};
