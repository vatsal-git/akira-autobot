const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen, nativeImage, clipboard, session } = require('electron');
app.name = 'Akira';
const path = require('path');
const os = require('os');
const Store = require('electron-store');

// Get Windows version (for Win10 vs Win11 detection)
function getWindowsVersion() {
  if (process.platform !== 'win32') return null;
  const release = os.release(); // e.g., "10.0.22621" for Win11
  const buildNumber = parseInt(release.split('.')[2], 10);
  return { release, buildNumber, isWin11: buildNumber >= 22000 };
}

// Get platform-specific blur/vibrancy options
function getBlurOptions() {
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: Use native vibrancy
    return {
      vibrancy: 'under-window',
      visualEffectState: 'active',
      transparent: true,
      backgroundColor: '#00000000'
    };
  }

  if (platform === 'win32') {
    // Windows 10/11: Use transparent background only
    // Note: backgroundMaterial: 'acrylic' causes a visible box behind the window
    return {
      transparent: true,
      backgroundColor: '#00000000'
    };
  }

  // Linux: No native blur, use transparent fallback
  return {
    transparent: true,
    backgroundColor: '#00000000'
  };
}

// Import tools (for backward compatibility)
const { executeTool, getToolsForAPI, getToolsWithCategories } = require('./tools');
const { getSystemPrompt } = require('./system-prompt');

// Import overlay system
const overlayManager = require('./overlay/overlay-manager');
const { onOverlayEvent } = require('./overlay/overlay-events');

// Import execute-command for streaming setup
const { setOutputEmitter } = require('./tools/system/execute-command');

// Import multi-agent system
const { runOrchestrator, runDirectAgent, initializeAgents, getAvailableAgents, setWorkspaceRoot, clearCache, getCacheStats, submitEmergencyResponse, submitClarificationResponse, getTodoList, clearTodoList, onTodoEvent } = require('./agents/init');

// Import message parser for agent tagging
const { parseAgentTag, isTaggableAgent, getTaggableAgentNames } = require('./agents/message-parser');

// Import provider system
const { getProviderList, getProvider } = require('./providers');

// Initialize store for settings
const store = new Store({
  name: 'akira-settings',
  defaults: {
    apiKey: '', // Legacy - kept for migration
    temperature: 0.7,
    corner: 'bottom-right',
    theme: 'system',
    widgetMode: 'compact', // compact, sidebar, window
    wasVisible: true,
    reasoningEnabled: true,
    disabledTools: [], // Array of tool names to disable
    hideDesktopOverlay: false, // Hide overlay visual feedback (red border, blue overlay, etc.)
    openAtLogin: true,
    // Provider settings
    selectedProvider: 'openrouter',
    selectedModel: 'openrouter/auto',
    providerApiKeys: {
      openrouter: '',
      anthropic: '',
      bedrock: '' // AWS Access Key ID
    },
    // Bedrock-specific credentials
    bedrockCredentials: {
      awsSecretAccessKey: '',
      awsRegion: 'us-east-1'
    },
    // Per-model settings (keyed by model ID)
    modelSettings: {},
    // Custom window dimensions
    compactWidth: 400,
    compactHeight: 500,
    sidebarWidth: 380,
    windowWidth: 500,
    windowHeight: 700
  }
});



let mainWindow = null;
let tray = null;
let currentCornerIndex = 3; // Start at bottom-right
let isQuitting = false; // Track if app is truly quitting vs window close

// Cleanup tray on process exit (handles dev server termination)
const cleanupTray = () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
};

// Handle various termination signals
process.on('exit', cleanupTray);
process.on('SIGINT', () => { cleanupTray(); process.exit(); });
process.on('SIGTERM', () => { cleanupTray(); process.exit(); });
process.on('SIGHUP', () => { cleanupTray(); process.exit(); });


// Window dimensions for different modes
const COMPACT_WIDTH = 400;
const COMPACT_HEIGHT = 500;
const SIDEBAR_WIDTH = 380;
const WINDOW_WIDTH = 500;
const WINDOW_HEIGHT = 700;
const MARGIN = 20;

// Corner order for auto-relocation
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

// Get position for a corner (compact mode)
function getCornerPosition(corner) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const width = store.get('compactWidth', COMPACT_WIDTH);
  const height = store.get('compactHeight', COMPACT_HEIGHT);

  switch (corner) {
    case 'top-left':
      return { x: MARGIN, y: MARGIN };
    case 'top-right':
      return { x: screenWidth - width - MARGIN, y: MARGIN };
    case 'bottom-left':
      return { x: MARGIN, y: screenHeight - height - MARGIN };
    case 'bottom-right':
    default:
      return { x: screenWidth - width - MARGIN, y: screenHeight - height - MARGIN };
  }
}

// Get window config based on mode
function getWindowConfig(mode) {
  const workArea = screen.getPrimaryDisplay().workArea;

  switch (mode) {
    case 'sidebar':
      const sidebarCorner = store.get('corner', 'right');
      // Normalize legacy corner values to left/right
      const sidebarPosition = (sidebarCorner === 'left' || sidebarCorner === 'top-left') ? 'left' : 'right';
      const sidebarWidth = store.get('sidebarWidth', SIDEBAR_WIDTH);
      return {
        width: sidebarWidth,
        height: workArea.height,
        x: sidebarPosition === 'left' ? workArea.x : workArea.x + workArea.width - sidebarWidth,
        y: workArea.y,
        alwaysOnTop: true,
        skipTaskbar: true,
        frame: false,
        transparent: true
      };
    case 'window':
      const windowWidth = store.get('windowWidth', WINDOW_WIDTH);
      const windowHeight = store.get('windowHeight', WINDOW_HEIGHT);
      return {
        width: windowWidth,
        height: windowHeight,
        x: Math.round((workArea.width - windowWidth) / 2) + workArea.x,
        y: Math.round((workArea.height - windowHeight) / 2) + workArea.y,
        alwaysOnTop: false,
        skipTaskbar: false,
        frame: false,
        transparent: true
      };
    case 'compact':
    default:
      const corner = store.get('corner', 'bottom-right');
      const pos = getCornerPosition(corner);
      return {
        width: store.get('compactWidth', COMPACT_WIDTH),
        height: store.get('compactHeight', COMPACT_HEIGHT),
        x: pos.x,
        y: pos.y,
        alwaysOnTop: true,
        skipTaskbar: true,
        frame: false,
        transparent: true
      };
  }
}

function createWindow() {
  const widgetMode = store.get('widgetMode', 'compact');
  const config = getWindowConfig(widgetMode);

  // Always start at bottom-right corner with proper padding (like collapsed ball)
  if (widgetMode === 'compact') {
    store.set('corner', 'bottom-right');
    currentCornerIndex = 3; // bottom-right index
    const workArea = screen.getPrimaryDisplay().workArea;
    const cWidth = store.get('compactWidth', COMPACT_WIDTH);
    const cHeight = store.get('compactHeight', COMPACT_HEIGHT);
    config.x = Math.round(workArea.x + workArea.width - cWidth - MARGIN);
    config.y = Math.round(workArea.y + workArea.height - cHeight - MARGIN);
  }

  // Get platform-specific blur options
  const blurOptions = getBlurOptions();

  mainWindow = new BrowserWindow({
    title: 'Akira',
    width: config.width,
    height: config.height,
    x: config.x,
    y: config.y,
    frame: config.frame,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: config.skipTaskbar,
    resizable: true,
    minWidth: 320,
    minHeight: 400,
    hasShadow: false, // Disable native shadow to prevent white box
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    ...blurOptions, // Apply platform-specific blur/vibrancy
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load the app
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:1420');
    // Uncomment to open DevTools in development
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('resize', () => {
    saveWindowSize();
  });

  // Intercept close (X button) - hide to tray instead of destroying
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Disable Ctrl+W (prevent accidental window close)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'w') {
      event.preventDefault();
    }
  });

  // Track visibility changes
  mainWindow.on('show', () => {
    store.set('wasVisible', true);
  });

  mainWindow.on('hide', () => {
    store.set('wasVisible', false);
  });

  // Restore visibility based on last state
  mainWindow.once('ready-to-show', () => {
    isWindowCollapsed = false;
    const wasVisible = store.get('wasVisible', true);

    if (wasVisible) {
      mainWindow.show();
      // Ensure window is focused and on top immediately on startup
      // Use 'pop-up-menu' level so overlay can appear above it
      if (config.alwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
        mainWindow.focus();
      }
    }
  });
}

function createTray() {
  // Use .ico for Windows system tray compatibility
  const iconPath = path.join(__dirname, 'icons', 'icon.ico');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Create a simple colored icon as fallback
      trayIcon = nativeImage.createFromBuffer(createSimpleIcon());
    }
  } catch (e) {
    trayIcon = nativeImage.createFromBuffer(createSimpleIcon());
  }

  // Windows system tray expects 16x16 icons
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Akira',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Hide',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Akira AI Assistant');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      const widgetMode = store.get('widgetMode', 'compact');
      const workArea = screen.getPrimaryDisplay().workArea;

      if (widgetMode === 'sidebar') {
        // Sidebar mode: move to right side
        store.set('corner', 'right');
        const sidebarWidth = store.get('sidebarWidth', SIDEBAR_WIDTH);
        const x = workArea.x + workArea.width - sidebarWidth;
        mainWindow.setPosition(x, workArea.y, true);
      } else {
        // Compact mode: move to bottom-right corner
        const corner = 'bottom-right';
        store.set('corner', corner);
        currentCornerIndex = CORNERS.indexOf(corner);

        const compactWidth = store.get('compactWidth', COMPACT_WIDTH);
        const compactHeight = store.get('compactHeight', COMPACT_HEIGHT);

        // If collapsed, restore to normal size first
        if (isWindowCollapsed) {
          const { x, y } = getCornerPosition(corner);
          mainWindow.setSize(compactWidth, compactHeight);
          mainWindow.setPosition(x, y, true);
        } else {
          const { x, y } = getCornerPosition(corner);
          mainWindow.setPosition(x, y, true);
        }
      }

      // Show and focus
      mainWindow.show();
      mainWindow.focus();

      // Emit event to frontend to expand if collapsed
      mainWindow.webContents.send('tray-expand');
    }
  });
}

// Create a simple 16x16 icon buffer (blue square)
function createSimpleIcon() {
  const size = 16;
  const channels = 4; // RGBA
  const buffer = Buffer.alloc(size * size * channels);

  for (let i = 0; i < size * size; i++) {
    buffer[i * channels] = 26;      // R
    buffer[i * channels + 1] = 26;  // G
    buffer[i * channels + 2] = 26;  // B
    buffer[i * channels + 3] = 255; // A
  }

  return buffer;
}

function registerGlobalShortcut() {
  // Toggle collapse/expand (Ctrl+Shift+A)
  globalShortcut.register('CommandOrControl+Shift+A', async () => {
    if (mainWindow) {
      await setCollapsedState(!isWindowCollapsed);
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Set permission handlers for microphone access
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (!webContents) return callback(false);
    const url = webContents.getURL();
    const isLocal = url.startsWith('http://localhost:') || url.startsWith('file://');
    
    if (isLocal && (permission === 'audioCapture' || permission === 'media')) {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const origin = requestingOrigin || (webContents && webContents.getURL()) || '';
    const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('file://');
    
    return isLocal && (permission === 'audioCapture' || permission === 'media');
  });

  // Request macOS microphone permission if applicable
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      console.log('Microphone access status on macOS:', granted);
    }).catch(err => {
      console.error('Failed to request macOS microphone access:', err);
    });
  }

  // Load persistent chat history
  loadPersistentHistory();

  // Configure start on startup settings
  try {
    app.setLoginItemSettings({
      openAtLogin: store.get('openAtLogin', true),
      path: app.getPath('exe')
    });
  } catch (error) {
    console.error('Failed to configure startup settings:', error);
  }

  createWindow();
  createTray();
  registerGlobalShortcut();

  // Create overlay window for visual feedback
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  overlayManager.createOverlayWindow(isDev);

  // Forward overlay events to overlay window
  onOverlayEvent('action', (action) => {
    overlayManager.showAction(action);
  });

  onOverlayEvent('screenshot', (data) => {
    overlayManager.showScreenshot(data.region, data.label, data.animate);
  });

  onOverlayEvent('tool', (info) => {
    overlayManager.showToolIndicator(info);
  });

  onOverlayEvent('agent', (active) => {
    overlayManager.showAgentActive(active);
  });

  // Set up command output streaming emitter
  setOutputEmitter((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('command-output', data);
    }
  });

  // Forward todo events to renderer
  onTodoEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat-stream', { event: event.type, data: event.data });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on window close - keep in tray
});

app.on('will-quit', () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
  overlayManager.destroy();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  overlayManager.destroy();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ============ IPC Handlers ============

// Settings
ipcMain.handle('get-settings', () => {
  // Migrate legacy apiKey to providerApiKeys if needed
  const legacyKey = store.get('apiKey', '');
  const providerKeys = store.get('providerApiKeys', { openrouter: '', anthropic: '' });
  if (legacyKey && !providerKeys.openrouter) {
    providerKeys.openrouter = legacyKey;
    store.set('providerApiKeys', providerKeys);
  }

  return {
    apiKey: store.get('apiKey', ''), // Legacy
    temperature: store.get('temperature'),
    corner: store.get('corner'),
    theme: store.get('theme'),
    widgetMode: store.get('widgetMode', 'compact'),
    defaultModel: store.get('defaultModel', 'openrouter/free'), // Legacy
    reasoningEnabled: store.get('reasoningEnabled', true),
    disabledTools: store.get('disabledTools', []),
    hideDesktopOverlay: store.get('hideDesktopOverlay', false),
    openAtLogin: store.get('openAtLogin', true),
    // Provider settings
    selectedProvider: store.get('selectedProvider', 'openrouter'),
    selectedModel: store.get('selectedModel', 'openrouter/auto'),
    providerApiKeys: providerKeys
  };
});

// Get tools with categories for UI
ipcMain.handle('get-tools-with-categories', () => {
  return getToolsWithCategories();
});

ipcMain.handle('save-settings', (event, settings) => {
  Object.keys(settings).forEach(key => {
    store.set(key, settings[key]);
  });

  // Notify overlay if hideDesktopOverlay changed
  if ('hideDesktopOverlay' in settings) {
    overlayManager.setOverlayHidden(settings.hideDesktopOverlay);
  }

  // Set startup status if openAtLogin changed
  if ('openAtLogin' in settings) {
    try {
      app.setLoginItemSettings({
        openAtLogin: settings.openAtLogin,
        path: app.getPath('exe')
      });
    } catch (error) {
      console.error('Failed to update startup settings:', error);
    }
  }

  return true;
});

ipcMain.handle('has-api-key', () => {
  const key = store.get('apiKey', '');
  return key && key.length > 0;
});

ipcMain.handle('set-api-key', (event, key) => {
  store.set('apiKey', key);
  return true;
});

ipcMain.handle('get-api-key', () => {
  return store.get('apiKey', '');
});

// Draft text persistence (survives app restarts)
ipcMain.handle('get-draft-text', () => {
  return store.get('draftText', '');
});

ipcMain.handle('set-draft-text', (event, text) => {
  store.set('draftText', text);
  return true;
});

// Clipboard file paths (cross-platform)
ipcMain.handle('get-clipboard-file-paths', () => {
  // Try text/uri-list first (Mac/Linux)
  const uriList = clipboard.read('text/uri-list');
  if (uriList) {
    return uriList
      .split('\n')
      .filter(line => line.startsWith('file://'))
      .map(uri => {
        // Handle file:// URIs - remove prefix and decode
        let path = uri.replace(/^file:\/\//, '');
        // On Windows, file URIs have an extra slash: file:///C:/path
        if (process.platform === 'win32' && path.startsWith('/')) {
          path = path.substring(1);
        }
        return decodeURIComponent(path);
      });
  }

  // Windows: read FileNameW format (CF_HDROP)
  if (process.platform === 'win32') {
    try {
      const buffer = clipboard.readBuffer('FileNameW');
      if (buffer && buffer.length > 0) {
        // FileNameW is null-terminated UTF-16LE strings, double-null at end
        let str = buffer.toString('utf16le');
        // Remove trailing nulls and split by null
        str = str.replace(/\0+$/, '');
        const parts = str.split('\0');
        return parts.filter(p => p.length > 0);
      }
    } catch (e) {
      // No file paths in clipboard
    }
  }

  return [];
});

// Window control
ipcMain.handle('switch-corner', (event, corner) => {
  const widgetMode = store.get('widgetMode', 'compact');
  store.set('corner', corner);

  if (widgetMode === 'sidebar') {
    // Sidebar mode: handle left/right positions
    if (mainWindow) {
      const workArea = screen.getPrimaryDisplay().workArea;
      const sidebarWidth = store.get('sidebarWidth', SIDEBAR_WIDTH);
      const x = corner === 'left' ? workArea.x : workArea.x + workArea.width - sidebarWidth;
      mainWindow.setPosition(x, workArea.y, true);
    }
  } else {
    // Compact mode: handle corner positions
    currentCornerIndex = CORNERS.indexOf(corner);
    if (currentCornerIndex === -1) currentCornerIndex = 3;
    if (mainWindow) {
      const { x, y } = getCornerPosition(corner);
      mainWindow.setPosition(x, y, true);
    }
  }
  return true;
});

// Auto-relocate to next corner (called on mouse enter)
ipcMain.handle('auto-relocate', () => {
  const widgetMode = store.get('widgetMode', 'compact');

  // In sidebar mode, only allow left and right
  if (widgetMode === 'sidebar') {
    const currentCorner = store.get('corner', 'right');
    const nextCorner = currentCorner === 'left' ? 'right' : 'left';
    store.set('corner', nextCorner);
    if (mainWindow) {
      const workArea = screen.getPrimaryDisplay().workArea;
      const sidebarWidth = store.get('sidebarWidth', SIDEBAR_WIDTH);
      const x = nextCorner === 'left' ? workArea.x : workArea.x + workArea.width - sidebarWidth;
      mainWindow.setPosition(x, workArea.y, true);
    }
    return nextCorner;
  }

  // For other modes, cycle through all corners
  currentCornerIndex = (currentCornerIndex + 1) % CORNERS.length;
  const nextCorner = CORNERS[currentCornerIndex];
  store.set('corner', nextCorner);
  if (mainWindow) {
    const { x, y } = getCornerPosition(nextCorner);
    mainWindow.setPosition(x, y, true);
  }
  return nextCorner;
});

ipcMain.handle('toggle-widget', () => {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  }
  return true;
});

// Fullscreen toggle (for window mode)
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  }
  return false;
});

ipcMain.handle('is-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

// Minimize window (for window mode)
ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
  return true;
});

// Toggle maximize/restore (for window mode)
ipcMain.handle('toggle-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  }
  return false;
});

ipcMain.handle('is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Change widget mode (resize/reposition existing window to preserve React state)
ipcMain.handle('set-widget-mode', async (event, mode) => {
  store.set('widgetMode', mode);

  // Set appropriate default position for the mode
  if (mode === 'sidebar') {
    store.set('corner', 'right');
  } else if (mode === 'compact') {
    store.set('corner', 'bottom-right');
    currentCornerIndex = 3;
  }

  if (!mainWindow) {
    createWindow();
    return true;
  }

  // Get new window configuration
  const config = getWindowConfig(mode);

  // Update window properties without recreation
  // Use 'pop-up-menu' level so overlay can appear above it
  mainWindow.setAlwaysOnTop(config.alwaysOnTop, config.alwaysOnTop ? 'pop-up-menu' : undefined);

  // On Windows, setSkipTaskbar doesn't always take effect while visible
  // Hide briefly, apply the setting, then show again
  const wasVisible = mainWindow.isVisible();
  if (wasVisible && process.platform === 'win32') {
    mainWindow.hide();
  }
  mainWindow.setSkipTaskbar(config.skipTaskbar);
  if (wasVisible && process.platform === 'win32') {
    mainWindow.show();
  }

  // Animate to new bounds
  await animateBounds({
    x: config.x,
    y: config.y,
    width: config.width,
    height: config.height
  }, 200);

  // Notify renderer of mode change
  mainWindow.webContents.send('widget-mode-changed', mode);

  return true;
});

// Collapsed tab dimensions (thin vertical bar on right edge)
const COLLAPSED_WIDTH = 24;
const COLLAPSED_HEIGHT = 60;
let isWindowCollapsed = false;
let animationInProgress = false;

// Smooth window bounds animation using setInterval for consistent timing
function animateBounds(targetBounds, duration = 180) {
  if (!mainWindow || animationInProgress) return Promise.resolve();

  animationInProgress = true;
  const startBounds = mainWindow.getBounds();
  const startTime = Date.now();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * eased),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * eased),
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * eased),
        height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * eased)
      };

      mainWindow.setBounds(currentBounds);

      if (progress >= 1) {
        clearInterval(interval);
        mainWindow.setBounds(targetBounds);
        animationInProgress = false;
        resolve();
      }
    }, 16); // ~60fps
  });
}

// Determine which corner to anchor based on ball position (quadrant check)
function getAnchorCorner(ballX, ballY, workArea) {
  const centerX = workArea.x + workArea.width / 2;
  const centerY = workArea.y + workArea.height / 2;

  const isLeft = ballX < centerX;
  const isTop = ballY < centerY;

  if (isTop && isLeft) return 'top-left';
  if (isTop && !isLeft) return 'top-right';
  if (!isTop && isLeft) return 'bottom-left';
  return 'bottom-right';
}

// Calculate window position based on ball position and anchor corner, clamped to screen
function getExpandedPosition(ballBounds, windowWidth, windowHeight, workArea) {
  const anchorCorner = getAnchorCorner(ballBounds.x, ballBounds.y, workArea);

  let x, y;

  switch (anchorCorner) {
    case 'top-left':
      // Ball is at top-left corner of window
      x = ballBounds.x;
      y = ballBounds.y;
      break;
    case 'top-right':
      // Ball is at top-right corner of window
      x = ballBounds.x + ballBounds.width - windowWidth;
      y = ballBounds.y;
      break;
    case 'bottom-left':
      // Ball is at bottom-left corner of window
      x = ballBounds.x;
      y = ballBounds.y + ballBounds.height - windowHeight;
      break;
    case 'bottom-right':
    default:
      // Ball is at bottom-right corner of window
      x = ballBounds.x + ballBounds.width - windowWidth;
      y = ballBounds.y + ballBounds.height - windowHeight;
      break;
  }

  // Clamp to screen bounds with margin
  x = Math.max(workArea.x + MARGIN, Math.min(x, workArea.x + workArea.width - windowWidth - MARGIN));
  y = Math.max(workArea.y + MARGIN, Math.min(y, workArea.y + workArea.height - windowHeight - MARGIN));

  return { x: Math.round(x), y: Math.round(y) };
}

// Save current window size to store
function saveWindowSize() {
  if (!mainWindow || isWindowCollapsed || animationInProgress) return;
  if (mainWindow.isMaximized() || mainWindow.isFullScreen() || mainWindow.isMinimized()) return;

  const widgetMode = store.get('widgetMode', 'compact');
  const { width, height } = mainWindow.getBounds();

  // Validate that bounds are reasonable (not collapsed size or 0)
  if (width <= COLLAPSED_WIDTH || height <= COLLAPSED_HEIGHT) return;

  switch (widgetMode) {
    case 'compact':
      store.set('compactWidth', width);
      store.set('compactHeight', height);
      break;
    case 'sidebar':
      store.set('sidebarWidth', width);
      break;
    case 'window':
      store.set('windowWidth', width);
      store.set('windowHeight', height);
      break;
  }
}

// Set collapsed state (used by IPC and shortcut)
async function setCollapsedState(collapsed) {
  if (!mainWindow) return false;

  isWindowCollapsed = collapsed;
  // Use workArea which includes x, y origin (accounts for taskbar position)
  const workArea = screen.getPrimaryDisplay().workArea;
  const widgetMode = store.get('widgetMode', 'compact');

  // Notify renderer of collapsed state change first for expand (so UI updates before animation)
  if (!collapsed) {
    mainWindow.webContents.send('collapsed-changed', collapsed);
  }

  if (collapsed) {
    // Position collapsed tab: flush with right edge, padding from bottom (taskbar)
    const x = Math.round(workArea.x + workArea.width - COLLAPSED_WIDTH);
    const y = Math.round(workArea.y + workArea.height - COLLAPSED_HEIGHT - MARGIN);
    await animateBounds({ x, y, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT });
    // Notify renderer after collapse animation
    mainWindow.webContents.send('collapsed-changed', collapsed);
  } else {
    // Get target size based on widget mode
    const config = getWindowConfig(widgetMode);

    let x, y;
    if (widgetMode === 'sidebar') {
      // Sidebar mode: snap to edge (no margin), full height
      const sidebarCorner = store.get('corner', 'right');
      x = sidebarCorner === 'left' ? workArea.x : workArea.x + workArea.width - config.width;
      y = workArea.y;
    } else {
      // Compact mode: use ball position to determine anchor corner
      const ballBounds = mainWindow.getBounds();
      const pos = getExpandedPosition(ballBounds, config.width, config.height, workArea);
      x = pos.x;
      y = pos.y;
    }

    await animateBounds({ x, y, width: config.width, height: config.height });
    // Focus window so user can start typing
    mainWindow.focus();
  }

  return true;
}

ipcMain.handle('set-collapsed', async (event, collapsed) => {
  return setCollapsedState(collapsed);
});

// Move window by delta (for dragging)
ipcMain.handle('move-window', (event, { deltaX, deltaY }) => {
  if (!mainWindow) return false;
  const [x, y] = mainWindow.getPosition();
  const widgetMode = store.get('widgetMode', 'compact');

  // In sidebar mode, only allow horizontal movement
  if (widgetMode === 'sidebar') {
    mainWindow.setPosition(x + deltaX, y);
  } else {
    mainWindow.setPosition(x + deltaX, y + deltaY);
  }
  return true;
});

// Move window by direction (Ctrl+A + arrow key shortcut)
ipcMain.handle('move-window-direction', (event, direction) => {
  if (!mainWindow) return false;

  const widgetMode = store.get('widgetMode', 'compact');
  const workArea = screen.getPrimaryDisplay().workArea;

  // Window mode: no movement shortcuts
  if (widgetMode === 'window') return false;

  if (widgetMode === 'sidebar') {
    // Sidebar mode: only left/right movement
    if (direction === 'left') {
      store.set('corner', 'left');
      mainWindow.setPosition(workArea.x, workArea.y, true);
    } else if (direction === 'right') {
      store.set('corner', 'right');
      const sidebarWidth = store.get('sidebarWidth', SIDEBAR_WIDTH);
      mainWindow.setPosition(workArea.x + workArea.width - sidebarWidth, workArea.y, true);
    }
    return store.get('corner');
  }

  // Compact mode: move to corner based on direction
  const currentCorner = store.get('corner', 'bottom-right');
  let newCorner = currentCorner;

  // Parse current position
  const isTop = currentCorner.includes('top');
  const isLeft = currentCorner.includes('left');

  switch (direction) {
    case 'up':
      // Move to top, keep horizontal position
      newCorner = isLeft ? 'top-left' : 'top-right';
      break;
    case 'down':
      // Move to bottom, keep horizontal position
      newCorner = isLeft ? 'bottom-left' : 'bottom-right';
      break;
    case 'left':
      // Move to left, keep vertical position
      newCorner = isTop ? 'top-left' : 'bottom-left';
      break;
    case 'right':
      // Move to right, keep vertical position
      newCorner = isTop ? 'top-right' : 'bottom-right';
      break;
  }

  // Apply the new corner position
  store.set('corner', newCorner);
  currentCornerIndex = CORNERS.indexOf(newCorner);
  const { x, y } = getCornerPosition(newCorner);
  mainWindow.setPosition(x, y, true);

  return newCorner;
});

// OpenRouter API
ipcMain.handle('test-connection', async (event, apiKey) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://akira.app',
        'X-Title': 'Akira Desktop'
      }
    });
    return response.ok;
  } catch (e) {
    return false;
  }
});

// Get list of available providers
ipcMain.handle('get-providers', () => {
  return getProviderList();
});

// Get API key for a specific provider
ipcMain.handle('get-provider-api-key', (event, providerId) => {
  const keys = store.get('providerApiKeys', {});
  return keys[providerId] || '';
});

// Set API key for a specific provider
ipcMain.handle('set-provider-api-key', (event, { providerId, apiKey }) => {
  const keys = store.get('providerApiKeys', {});
  keys[providerId] = apiKey;
  store.set('providerApiKeys', keys);
  return true;
});

// Get currently selected provider
ipcMain.handle('get-selected-provider', () => {
  return store.get('selectedProvider', 'openrouter');
});

// Set selected provider
ipcMain.handle('set-selected-provider', (event, providerId) => {
  store.set('selectedProvider', providerId);
  // Set default model for this provider if no model is set
  const provider = getProvider(providerId);
  if (provider) {
    const currentModel = store.get('selectedModel', '');
    if (!currentModel || currentModel.startsWith('openrouter/')) {
      store.set('selectedModel', provider.defaultModel);
    }
  }
  return true;
});

// Get selected model
ipcMain.handle('get-selected-model', () => {
  return store.get('selectedModel', 'openrouter/auto');
});

// Set selected model
ipcMain.handle('set-selected-model', (event, model) => {
  store.set('selectedModel', model);
  return true;
});

// Get Bedrock credentials
ipcMain.handle('get-bedrock-credentials', () => {
  return store.get('bedrockCredentials', { awsSecretAccessKey: '', awsRegion: 'us-east-1' });
});

// Set Bedrock credentials
ipcMain.handle('set-bedrock-credentials', (event, credentials) => {
  store.set('bedrockCredentials', credentials);
  return true;
});

// Get overlay hidden state (for overlay window initialization)
ipcMain.handle('get-overlay-hidden-state', () => {
  return store.get('hideDesktopOverlay', false);
});

// Get model-specific settings
ipcMain.handle('get-model-settings', (event, modelId) => {
  const allModelSettings = store.get('modelSettings', {});
  return allModelSettings[modelId] || { maxTokens: 16384, thinkingBudget: 10000 };
});

// Set model-specific settings
ipcMain.handle('set-model-settings', (event, modelId, settings) => {
  const allModelSettings = store.get('modelSettings', {});
  allModelSettings[modelId] = { ...allModelSettings[modelId], ...settings };
  store.set('modelSettings', allModelSettings);
  return true;
});

// Legacy: Model selection (kept for backward compatibility)
ipcMain.handle('get-models', () => {
  return [
    { id: 'openrouter/auto', name: 'OpenRouter Auto' },
    { id: 'openrouter/free', name: 'OpenRouter Free' }
  ];
});

// Conversation history storage (in-memory, keyed by chatId)
// Conversation history storage (in-memory, keyed by chatId)
const conversationHistory = new Map();
const MAX_HISTORY_LENGTH = 50; // Max messages per conversation

// Store AbortControllers for ongoing generations (chatId -> AbortController)
const generationControllers = new Map();

// Persistent chat history store
const chatHistoryStore = new Store({
  name: 'akira-chat-history',
  defaults: {
    chats: [] // Array of { id, title, createdAt, updatedAt, messages }
  }
});

// Load conversation history from persistent store on startup
function loadPersistentHistory() {
  const chats = chatHistoryStore.get('chats', []);
  chats.forEach(chat => {
    if (chat.messages && chat.messages.length > 0) {
      conversationHistory.set(chat.id, chat.messages);
    }
  });
  console.log(`Loaded ${chats.length} chats from persistent storage`);
}

// Save a chat to persistent storage
function saveChatToPersistent(chatId, messages, title = null) {
  const chats = chatHistoryStore.get('chats', []);
  const existingIndex = chats.findIndex(c => c.id === chatId);

  // Generate title from first user message if not provided
  const chatTitle = title || generateChatTitle(messages);

  const chatData = {
    id: chatId,
    title: chatTitle,
    createdAt: existingIndex >= 0 ? chats[existingIndex].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages
  };

  if (existingIndex >= 0) {
    chats[existingIndex] = chatData;
  } else {
    chats.unshift(chatData); // Add to beginning
  }

  // Keep only last 100 chats
  if (chats.length > 100) {
    chats.splice(100);
  }

  chatHistoryStore.set('chats', chats);
  return chatData;
}

// Generate a title from chat messages
function generateChatTitle(messages) {
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (firstUserMsg && firstUserMsg.content) {
    const content = firstUserMsg.content.trim();
    return content.length > 50 ? content.substring(0, 50) + '...' : content;
  }
  return 'New Chat';
}


// Chat with Multi-Agent System
ipcMain.on('send-message', async (event, { message, chatId, skipCache = false }) => {
  // Get provider settings
  const selectedProvider = store.get('selectedProvider', 'openrouter');
  const providerKeys = store.get('providerApiKeys', {});
  const apiKey = providerKeys[selectedProvider] || store.get('apiKey', ''); // Fallback to legacy

  if (!apiKey) {
    const provider = getProvider(selectedProvider);
    event.reply('chat-stream', {
      event: 'error',
      data: { error: `${provider?.name || selectedProvider} API key not configured` },
      chatId
    });
    return;
  }

  const temperature = store.get('temperature', 0.7);
  const finalChatId = chatId || require('uuid').v4();

  // Create AbortController for this generation
  const controller = new AbortController();
  generationControllers.set(finalChatId, controller);

  // Get or create conversation history (stores ALL message types in chronological order)
  let messages = conversationHistory.get(finalChatId) || [];

  // Add user message to history
  messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

  // Trim history if too long
  if (messages.length > MAX_HISTORY_LENGTH) {
    messages = messages.slice(-MAX_HISTORY_LENGTH);
  }

  // Save updated history
  conversationHistory.set(finalChatId, messages);

  // Send meta event
  event.reply('chat-stream', { event: 'meta', data: { chat_id: finalChatId }, chatId: finalChatId });

  // Get selected model from settings
  const selectedModel = store.get('selectedModel', 'openrouter/auto');

  // Get additional credentials for Bedrock
  const bedrockCredentials = store.get('bedrockCredentials', {});

  // API configuration for agents
  const reasoningEnabled = store.get('reasoningEnabled', true);
  const disabledTools = store.get('disabledTools', []);
  // Get model-specific settings
  const allModelSettings = store.get('modelSettings', {});
  const modelSettings = allModelSettings[selectedModel] || { maxTokens: 16384, thinkingBudget: 10000 };
  const apiConfig = {
    apiKey,
    model: selectedModel,
    temperature,
    maxTokens: modelSettings.maxTokens,
    thinkingBudget: modelSettings.thinkingBudget,
    provider: selectedProvider,
    credentials: selectedProvider === 'bedrock' ? bedrockCredentials : {},
    reasoningEnabled,
    disabledTools
  };

  // Track accumulated content and reasoning for current assistant response
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  let reasoningIndex = 0;
  let usedModel = selectedModel;

  // Event handler that translates agent events to IPC events AND saves to history
  const onEvent = (agentEvent) => {
    switch (agentEvent.type) {
      case 'agent_start':
        // Save agent start to history
        messages.push({
          type: 'agent',
          agent: agentEvent.agent,
          displayName: agentEvent.displayName,
          task: agentEvent.task,
          status: 'running',
          timestamp: new Date().toISOString()
        });
        conversationHistory.set(finalChatId, messages);

        // Show overlay when BeneGes (desktop agent) starts
        if (agentEvent.agent === 'beneges') {
          overlayManager.showAgentActive(true);
        }

        // Send agent activity event
        event.reply('chat-stream', {
          event: 'agent_start',
          data: {
            agent: agentEvent.agent,
            displayName: agentEvent.displayName,
            task: agentEvent.task
          },
          chatId: finalChatId
        });
        break;

      case 'agent_delegate':
        // Save delegation to history
        messages.push({
          type: 'delegation',
          fromAgent: agentEvent.fromAgent,
          toAgent: agentEvent.toAgent,
          task: agentEvent.task,
          timestamp: new Date().toISOString()
        });
        conversationHistory.set(finalChatId, messages);

        // Show overlay when delegating to BeneGes (desktop agent)
        if (agentEvent.toAgent === 'beneges') {
          overlayManager.showAgentActive(true);
        }

        // Send delegation event
        event.reply('chat-stream', {
          event: 'agent_delegate',
          data: {
            fromAgent: agentEvent.fromAgent,
            toAgent: agentEvent.toAgent,
            task: agentEvent.task
          },
          chatId: finalChatId
        });
        break;

      case 'agent_complete':
        // If there's accumulated content from the completing agent, save it
        if (accumulatedContent.trim()) {
          messages.push({
            role: 'assistant',
            content: accumulatedContent,
            timestamp: new Date().toISOString()
          });
          accumulatedContent = '';
        }

        // Update agent status in history
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].type === 'agent' && messages[i].agent === agentEvent.agent && messages[i].status === 'running') {
            messages[i].status = 'complete';
            break;
          }
        }
        conversationHistory.set(finalChatId, messages);

        // Hide overlay when BeneGes (desktop agent) completes
        if (agentEvent.agent === 'beneges') {
          overlayManager.showAgentActive(false);
        }

        // Send completion event
        event.reply('chat-stream', {
          event: 'agent_complete',
          data: {
            agent: agentEvent.agent,
            displayName: agentEvent.displayName
          },
          chatId: finalChatId
        });
        break;

      case 'agent_error':
        console.log(`[${finalChatId}] Agent error:`, agentEvent.error);
        break;

      case 'delta':
        // Accumulate content - we'll save the complete assistant message at the end
        accumulatedContent += agentEvent.delta;

        // Stream content delta
        event.reply('chat-stream', {
          event: 'delta',
          data: { delta: agentEvent.delta },
          chatId: finalChatId
        });
        break;

      case 'reasoning':
        // Accumulate reasoning
        accumulatedReasoning += agentEvent.reasoning;

        // Stream reasoning
        event.reply('chat-stream', {
          event: 'reasoning',
          data: { reasoning: agentEvent.reasoning },
          chatId: finalChatId
        });
        break;

      case 'reasoning_complete':
        // Save completed reasoning block to history
        if (accumulatedReasoning) {
          reasoningIndex++;
          messages.push({
            type: 'reasoning',
            content: accumulatedReasoning,
            status: 'complete',
            index: reasoningIndex,
            timestamp: new Date().toISOString()
          });
          conversationHistory.set(finalChatId, messages);
          accumulatedReasoning = '';
        }
        break;

      case 'tool_use':
        // If there's accumulated reasoning, save it first (reasoning ends when tool starts)
        if (accumulatedReasoning) {
          reasoningIndex++;
          messages.push({
            type: 'reasoning',
            content: accumulatedReasoning,
            status: 'complete',
            index: reasoningIndex,
            timestamp: new Date().toISOString()
          });
          accumulatedReasoning = '';
        }

        // If there's accumulated content, save it as assistant message before tool
        if (accumulatedContent.trim()) {
          messages.push({
            role: 'assistant',
            content: accumulatedContent,
            timestamp: new Date().toISOString()
          });
          accumulatedContent = '';
        }

        // Save tool use to history
        messages.push({
          type: 'tool',
          toolId: agentEvent.toolId,
          name: agentEvent.name,
          input: agentEvent.input,
          agent: agentEvent.agent,
          status: 'running',
          result: null,
          timestamp: new Date().toISOString()
        });
        conversationHistory.set(finalChatId, messages);

        // Tool use event
        event.reply('chat-stream', {
          event: 'tool_use',
          data: {
            toolId: agentEvent.toolId,
            name: agentEvent.name,
            input: agentEvent.input,
            agent: agentEvent.agent
          },
          chatId: finalChatId
        });

        // Show overlay for desktop automation tools
        if (agentEvent.name && agentEvent.name.startsWith('desktop_')) {
          overlayManager.showAgentActive(true);
          overlayManager.showToolIndicator({
            name: agentEvent.name,
            status: 'start'
          });
        }

        console.log(`[${finalChatId}] [${agentEvent.agent}] Tool: ${agentEvent.name}`, agentEvent.input);
        break;

      case 'tool_result':
        // Update tool result in history
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].type === 'tool' && messages[i].toolId === agentEvent.toolId) {
            messages[i].status = 'completed';
            messages[i].result = agentEvent.result;
            break;
          }
        }
        conversationHistory.set(finalChatId, messages);

        // Tool result event
        event.reply('chat-stream', {
          event: 'tool_result',
          data: {
            toolId: agentEvent.toolId,
            name: agentEvent.name,
            result: agentEvent.result,
            agent: agentEvent.agent
          },
          chatId: finalChatId
        });

        // Show tool completion indicator for desktop automation tools
        if (agentEvent.name && agentEvent.name.startsWith('desktop_')) {
          const success = agentEvent.result?.success !== false && !agentEvent.result?.error;
          overlayManager.showToolIndicator({
            name: agentEvent.name,
            status: 'complete',
            success
          });
        }
        break;
    }
  };

  // Parse message for agent tag (@agentname syntax)
  const { tagged, agentName: taggedAgent, message: actualMessage } = parseAgentTag(message);

  // Validate tagged agent if present
  if (tagged) {
    const availableAgents = getAvailableAgents();
    if (!isTaggableAgent(taggedAgent, availableAgents)) {
      const taggableNames = getTaggableAgentNames(availableAgents);
      event.reply('chat-stream', {
        event: 'error',
        data: { error: `Unknown agent '@${taggedAgent}'. Available agents: ${taggableNames.join(', ')}` },
        chatId: finalChatId
      });
      generationControllers.delete(finalChatId);
      return;
    }
    console.log(`[${finalChatId}] Direct agent call to @${taggedAgent} (model: ${selectedModel})`);
  } else {
    console.log(`[${finalChatId}] Starting multi-agent orchestration (model: ${selectedModel}, skipCache: ${skipCache})`);
  }

  // Track if response was from cache
  let wasCached = false;

  try {
    // Extract LLM-relevant conversation history (user and assistant messages only)
    // Exclude the just-added user message (last item) since it's passed as 'message'
    const llmHistory = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1)
      .map(m => ({ role: m.role, content: m.content }));

    // Route to direct agent or orchestrator based on tag
    let result;
    if (tagged) {
      // Direct agent call - bypass orchestrator
      result = await runDirectAgent({
        agentName: taggedAgent,
        message: actualMessage,
        conversationHistory: llmHistory,
        apiConfig,
        onEvent,
        signal: controller.signal
      });
    } else {
      // Normal orchestrator flow
      result = await runOrchestrator({
        message,
        conversationHistory: llmHistory,
        apiConfig,
        onEvent,
        signal: controller.signal,
        skipCache
      });
    }

    // Check if response was cached
    wasCached = result.cached === true;

    // Save any remaining reasoning before final response
    if (accumulatedReasoning) {
      reasoningIndex++;
      messages.push({
        type: 'reasoning',
        content: accumulatedReasoning,
        status: 'complete',
        index: reasoningIndex,
        timestamp: new Date().toISOString()
      });
    }

    // Add remaining assistant content to history (only if there's content that wasn't saved before a tool)
    if (accumulatedContent.trim()) {
      messages.push({
        role: 'assistant',
        content: accumulatedContent,
        timestamp: new Date().toISOString(),
        cached: wasCached
      });
    }

    conversationHistory.set(finalChatId, messages);

    // Auto-save to persistent storage
    saveChatToPersistent(finalChatId, messages);

    // Cleanup controller
    generationControllers.delete(finalChatId);

    event.reply('chat-stream', {
      event: 'done',
      data: { chat_id: finalChatId, model: usedModel, cached: wasCached },
      chatId: finalChatId
    });

  } catch (e) {
    if (e.name === 'AbortError' || e.message === 'Agent execution cancelled') {
      console.log(`[${finalChatId}] Generation was cancelled by user`);

      // Save partial content to history if any
      if (accumulatedContent && accumulatedContent.trim()) {
        messages.push({
          role: 'assistant',
          content: accumulatedContent,
          incomplete: true,
          timestamp: new Date().toISOString()
        });
        conversationHistory.set(finalChatId, messages);
        saveChatToPersistent(finalChatId, messages);
      }

      generationControllers.delete(finalChatId);

      // Hide overlay when conversation is stopped
      overlayManager.showAgentActive(false);

      event.reply('chat-stream', {
        event: 'cancelled',
        data: { chat_id: finalChatId, partial: accumulatedContent || '' },
        chatId: finalChatId
      });
      return;
    }

    console.error(`[${finalChatId}] Error:`, e);
    generationControllers.delete(finalChatId);

    // Hide overlay on error
    overlayManager.showAgentActive(false);

    event.reply('chat-stream', {
      event: 'error',
      data: { error: e.message },
      chatId: finalChatId
    });
  }
});

// Cancel ongoing generation
ipcMain.handle('cancel-generation', (event, chatId) => {
  if (chatId && generationControllers.has(chatId)) {
    const controller = generationControllers.get(chatId);
    controller.abort();
    generationControllers.delete(chatId);
    console.log(`[${chatId}] Generation cancelled by user`);
    return true;
  }
  return false;
});

// Clear conversation history
ipcMain.handle('clear-chat', (event, chatId) => {
  if (chatId) {
    conversationHistory.delete(chatId);
    // Also cancel any ongoing generation for this chat
    if (generationControllers.has(chatId)) {
      generationControllers.get(chatId).abort();
      generationControllers.delete(chatId);
    }
  }
  // Clear todo list for new chat
  clearTodoList();
  return true;
});

// Todo list handlers
ipcMain.handle('get-todo-list', () => {
  return getTodoList();
});

ipcMain.handle('clear-todo-list', () => {
  clearTodoList();
  return true;
});

// ============ Chat History IPC Handlers ============

// Get all chat history (metadata only, without full messages)
ipcMain.handle('get-chat-history', () => {
  const chats = chatHistoryStore.get('chats', []);
  return chats.map(({ id, title, createdAt, updatedAt }) => ({
    id,
    title,
    createdAt,
    updatedAt
  }));
});

// Load a specific chat
ipcMain.handle('load-chat', (event, chatId) => {
  const chats = chatHistoryStore.get('chats', []);
  const chat = chats.find(c => c.id === chatId);
  if (chat) {
    // Also restore to in-memory history
    conversationHistory.set(chatId, chat.messages);
    return chat;
  }
  return null;
});

// Save current chat to history
ipcMain.handle('save-chat', (event, { chatId, messages, title }) => {
  if (!chatId || !messages || messages.length === 0) return null;
  return saveChatToPersistent(chatId, messages, title);
});

// Delete a chat from history
ipcMain.handle('delete-chat', (event, chatId) => {
  if (!chatId) return false;

  const chats = chatHistoryStore.get('chats', []);
  const filteredChats = chats.filter(c => c.id !== chatId);
  chatHistoryStore.set('chats', filteredChats);

  // Also remove from in-memory
  conversationHistory.delete(chatId);

  return true;
});

// ============ Emergency Stop and Clarification IPC Handlers ============

// Handle user response to emergency stop
ipcMain.handle('submit-emergency-response', (event, response) => {
  try {
    submitEmergencyResponse(response);
    return { success: true };
  } catch (error) {
    console.error('Error submitting emergency response:', error);
    return { success: false, error: error.message };
  }
});

// Handle user response to clarification request
ipcMain.handle('submit-clarification-response', (event, { clarificationId, response }) => {
  try {
    submitClarificationResponse(clarificationId, response);
    return { success: true };
  } catch (error) {
    console.error('Error submitting clarification response:', error);
    return { success: false, error: error.message };
  }
});

// Reset Akira - clear all data except API key, then reload
ipcMain.handle('reset-akira', async () => {
  try {
    // Get current API key to preserve it
    const apiKey = store.get('apiKey', '');

    // Clear all chat history
    chatHistoryStore.clear();

    // Clear in-memory conversations
    conversationHistory.clear();

    // Clear settings and restore defaults with preserved API key
    store.clear();
    store.set('apiKey', apiKey);

    // Also reset startup settings to default (true)
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe')
      });
    } catch (error) {
      console.error('Failed to reset startup settings:', error);
    }

    // Reload the app
    if (mainWindow) {
      mainWindow.reload();
    }

    return true;
  } catch (error) {
    console.error('Error resetting Akira:', error);
    return false;
  }
});

// ============ Agent Prompts IPC Handlers ============

// Get all agent prompts for settings
ipcMain.handle('get-agent-prompts', () => {
  try {
    const { getPrompt } = require('./agents/prompt-manager');
    const { getAvailableAgents, initializeAgents, isInitialized } = require('./agents/init');
    
    if (!isInitialized()) {
      const providerKeys = store.get('providerApiKeys', {});
      const apiKey = store.get('apiKey', '');
      const selectedProvider = store.get('selectedProvider', 'openrouter');
      initializeAgents({
        apiKey: providerKeys[selectedProvider] || apiKey,
        provider: selectedProvider,
        model: store.get('selectedModel')
      });
    }

    const agentsList = getAvailableAgents();
    
    return agentsList.map(agent => ({
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description,
      systemPrompt: getPrompt(agent.name)
    }));
  } catch (error) {
    console.error('Error getting agent prompts:', error);
    return [];
  }
});

// Update agent prompt
ipcMain.handle('update-agent-prompt', (event, { agentName, promptText }) => {
  try {
    const { updatePrompt } = require('./agents/prompt-manager');
    updatePrompt(agentName, promptText);
    return true;
  } catch (error) {
    console.error(`Error updating agent prompt for ${agentName}:`, error);
    return false;
  }
});

// Reset agent prompt to default
ipcMain.handle('reset-agent-prompt', (event, agentName) => {
  try {
    const { resetPrompt } = require('./agents/prompt-manager');
    return resetPrompt(agentName);
  } catch (error) {
    console.error(`Error resetting agent prompt for ${agentName}:`, error);
    return '';
  }
});

// ============ Cache Management IPC Handlers ============

// Get cache statistics
ipcMain.handle('get-cache-stats', () => {
  return getCacheStats();
});

// Clear response cache
ipcMain.handle('clear-response-cache', () => {
  clearCache();
  return true;
});
