const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Import tools
const { executeTool, getToolsForAPI } = require('./tools');
const { getSystemPrompt } = require('./system-prompt');

// Free OpenRouter models - dynamically fetched on startup
let FREE_MODELS = [];

// Known models that support tool/function calling (fallback list)
// These are either free or very cheap and confirmed to support tools
const KNOWN_TOOL_CAPABLE_MODELS = [
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', contextLength: 1048576, maxCompletionTokens: 8192, supportsTools: true },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', contextLength: 1000000, maxCompletionTokens: 8192, supportsTools: true },
  { id: 'google/gemini-flash-1.5-8b', name: 'Gemini Flash 1.5 8B', contextLength: 1000000, maxCompletionTokens: 8192, supportsTools: true },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', contextLength: 131072, maxCompletionTokens: 4096, supportsTools: true },
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', contextLength: 131072, maxCompletionTokens: 4096, supportsTools: true },
  { id: 'mistralai/mistral-nemo', name: 'Mistral Nemo', contextLength: 128000, maxCompletionTokens: 4096, supportsTools: true },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', contextLength: 131072, maxCompletionTokens: 4096, supportsTools: true },
];

// Fetch free models from OpenRouter API
async function fetchFreeModels() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'HTTP-Referer': 'https://akira.app',
        'X-Title': 'Akira Desktop'
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch models:', response.status);
      return;
    }

    const data = await response.json();

    // Filter for free chat models (exclude music, image, embedding, audio models)
    const excludePatterns = [
      'embedding', 'whisper', 'tts', 'audio', 'music', 'suno',
      'image', 'vision', 'dall-e', 'stable-diffusion', 'midjourney',
      'moderation', 'rerank'
    ];

    FREE_MODELS = data.data
      .filter(m => {
        const isFree = m.id.includes(':free') ||
                       (m.pricing?.prompt === '0' && m.pricing?.completion === '0') ||
                       (m.pricing?.prompt === 0 && m.pricing?.completion === 0);
        const idLower = m.id.toLowerCase();
        const isExcluded = excludePatterns.some(pattern => idLower.includes(pattern));
        // Only include models that output text (includes multimodal input models)
        const outputsText = m.architecture?.modality?.endsWith('->text') || !m.architecture?.modality;
        const isChat = !isExcluded && outputsText;
        // IMPORTANT: Only include models that support tool/function calling
        const supportsTools = m.supported_parameters?.includes('tools') ||
                              m.supported_parameters?.includes('tool_choice') ||
                              m.supported_parameters?.includes('functions');
        return isFree && isChat && supportsTools;
      })
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length,
        maxCompletionTokens: m.top_provider?.max_completion_tokens || null,
        supportsTools: true
      }))
      .sort((a, b) => (b.contextLength || 0) - (a.contextLength || 0)); // Sort by context length desc

    console.log(`Loaded ${FREE_MODELS.length} free models with tool support from OpenRouter:`);
    FREE_MODELS.slice(0, 10).forEach(m => console.log(`  - ${m.id}`));

    // If no free models support tools, use known tool-capable models as fallback
    if (FREE_MODELS.length === 0) {
      console.warn('No free models with tool support found. Using known tool-capable models.');
      console.warn('Note: These models may have usage costs. Check OpenRouter pricing.');
      FREE_MODELS = [...KNOWN_TOOL_CAPABLE_MODELS];
    }

    // Update default model if current one is not in the list
    const currentDefault = store.get('defaultModel');
    if (FREE_MODELS.length > 0 && !FREE_MODELS.find(m => m.id === currentDefault)) {
      store.set('defaultModel', FREE_MODELS[0].id);
      console.log(`Updated default model to: ${FREE_MODELS[0].id}`);
    }
  } catch (error) {
    console.error('Error fetching free models:', error);
  }
}

// Initialize store for settings
const store = new Store({
  name: 'akira-settings',
  defaults: {
    apiKey: '',
    defaultModel: '', // Will be set after fetching free models
    temperature: 0.7,
    corner: 'bottom-right',
    theme: 'system',
    widgetMode: 'compact', // compact, sidebar, window
    wasVisible: true
  }
});

let mainWindow = null;
let tray = null;
let currentCornerIndex = 3; // Start at bottom-right

// Track rate-limited models with cooldown (model -> timestamp when cooldown expires)
const rateLimitedModels = new Map();
const RATE_LIMIT_COOLDOWN_MS = 60000; // 60 seconds cooldown

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

  switch (corner) {
    case 'top-left':
      return { x: MARGIN, y: MARGIN };
    case 'top-right':
      return { x: screenWidth - COMPACT_WIDTH - MARGIN, y: MARGIN };
    case 'bottom-left':
      return { x: MARGIN, y: screenHeight - COMPACT_HEIGHT - MARGIN };
    case 'bottom-right':
    default:
      return { x: screenWidth - COMPACT_WIDTH - MARGIN, y: screenHeight - COMPACT_HEIGHT - MARGIN };
  }
}

// Get window config based on mode
function getWindowConfig(mode) {
  const workArea = screen.getPrimaryDisplay().workArea;

  switch (mode) {
    case 'sidebar':
      return {
        width: SIDEBAR_WIDTH,
        height: workArea.height,
        x: workArea.x + workArea.width - SIDEBAR_WIDTH,
        y: workArea.y,
        alwaysOnTop: true,
        skipTaskbar: true,
        frame: false,
        transparent: true
      };
    case 'window':
      return {
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        x: Math.round((workArea.width - WINDOW_WIDTH) / 2) + workArea.x,
        y: Math.round((workArea.height - WINDOW_HEIGHT) / 2) + workArea.y,
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
        width: COMPACT_WIDTH,
        height: COMPACT_HEIGHT,
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

  mainWindow = new BrowserWindow({
    width: config.width,
    height: config.height,
    x: config.x,
    y: config.y,
    frame: config.frame,
    transparent: config.transparent,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: config.skipTaskbar,
    resizable: true,
    minWidth: 320,
    minHeight: 400,
    backgroundMaterial: config.transparent ? 'acrylic' : 'none',
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
      if (config.alwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.focus();
      }
    }
  });
}

function createTray() {
  // Create a simple icon (16x16 colored square as fallback)
  const iconPath = path.join(__dirname, 'icons', 'tray.png');
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
      // Always move to bottom-right corner
      const corner = 'bottom-right';
      store.set('corner', corner);
      currentCornerIndex = CORNERS.indexOf(corner);

      // If collapsed, restore to normal size first
      if (isWindowCollapsed) {
        const { x, y } = getCornerPosition(corner);
        mainWindow.setSize(COMPACT_WIDTH, COMPACT_HEIGHT);
        mainWindow.setPosition(x, y, true);
      } else {
        const { x, y } = getCornerPosition(corner);
        mainWindow.setPosition(x, y, true);
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
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Load persistent chat history
  loadPersistentHistory();

  // Fetch free models from OpenRouter first
  await fetchFreeModels();

  createWindow();
  createTray();
  registerGlobalShortcut();

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
  globalShortcut.unregisterAll();
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
  return {
    apiKey: store.get('apiKey', ''),
    defaultModel: store.get('defaultModel'),
    maxTokens: store.get('maxTokens'),
    temperature: store.get('temperature'),
    corner: store.get('corner'),
    theme: store.get('theme'),
    widgetMode: store.get('widgetMode', 'compact')
  };
});

ipcMain.handle('save-settings', (event, settings) => {
  Object.keys(settings).forEach(key => {
    store.set(key, settings[key]);
  });
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

// Window control
ipcMain.handle('switch-corner', (event, corner) => {
  store.set('corner', corner);
  currentCornerIndex = CORNERS.indexOf(corner);
  if (currentCornerIndex === -1) currentCornerIndex = 3;
  if (mainWindow) {
    const { x, y } = getCornerPosition(corner);
    mainWindow.setPosition(x, y, true);
  }
  return true;
});

// Auto-relocate to next corner (called on mouse enter)
ipcMain.handle('auto-relocate', () => {
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

// Change widget mode (requires window recreation)
ipcMain.handle('set-widget-mode', async (event, mode) => {
  store.set('widgetMode', mode);

  // Recreate window with new mode
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }

  // Small delay to ensure cleanup
  await new Promise(r => setTimeout(r, 100));

  createWindow();
  return true;
});

// Collapsed ball dimensions
const COLLAPSED_SIZE = 48;
let isWindowCollapsed = false;
let animationInProgress = false;

// Smooth window bounds animation
function animateBounds(targetBounds, duration = 200) {
  if (!mainWindow || animationInProgress) return Promise.resolve();

  animationInProgress = true;
  const startBounds = mainWindow.getBounds();
  const startTime = Date.now();
  const steps = 20;
  const stepDuration = duration / steps;

  return new Promise((resolve) => {
    const animate = () => {
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

      if (progress < 1) {
        setTimeout(animate, stepDuration);
      } else {
        mainWindow.setBounds(targetBounds);
        animationInProgress = false;
        resolve();
      }
    };

    animate();
  });
}

ipcMain.handle('set-collapsed', async (event, collapsed) => {
  if (!mainWindow) return false;

  isWindowCollapsed = collapsed;
  // Use workArea which includes x, y origin (accounts for taskbar position)
  const workArea = screen.getPrimaryDisplay().workArea;

  // Notify renderer of collapsed state change first for expand (so UI updates before animation)
  if (!collapsed) {
    mainWindow.webContents.send('collapsed-changed', collapsed);
  }

  if (collapsed) {
    // Position collapsed ball at bottom-right with same margin as window
    const x = Math.round(workArea.x + workArea.width - COLLAPSED_SIZE - MARGIN);
    const y = Math.round(workArea.y + workArea.height - COLLAPSED_SIZE - MARGIN);
    await animateBounds({ x, y, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE });
    // Notify renderer after collapse animation
    mainWindow.webContents.send('collapsed-changed', collapsed);
  } else {
    // Restore to mode-appropriate size
    const widgetMode = store.get('widgetMode', 'compact');
    const config = getWindowConfig(widgetMode);
    await animateBounds({ x: config.x, y: config.y, width: config.width, height: config.height });
  }

  return true;
});

// Move window by delta (for dragging)
ipcMain.handle('move-window', (event, { deltaX, deltaY }) => {
  if (!mainWindow) return false;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + deltaX, y + deltaY);
  return true;
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

ipcMain.handle('get-models', async (event, apiKey) => {
  // Return the dynamically fetched free models
  // If user has API key, we could fetch all models, but free models are sufficient
  if (FREE_MODELS.length === 0) {
    await fetchFreeModels();
  }
  return FREE_MODELS;
});

ipcMain.handle('get-free-models', () => {
  return FREE_MODELS;
});

ipcMain.handle('refresh-models', async () => {
  await fetchFreeModels();
  return FREE_MODELS;
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


// Chat with tools and automatic model fallback
ipcMain.on('send-message', async (event, { message, chatId, model, history }) => {
  const apiKey = store.get('apiKey', '');
  if (!apiKey) {
    event.reply('chat-stream', { event: 'error', data: { error: 'API key not configured' }, chatId });
    return;
  }

  const settings = {
    maxTokens: store.get('maxTokens', 4096),
    temperature: store.get('temperature', 0.7),
    thinkingEnabled: store.get('thinkingEnabled', true),
    thinkingBudget: store.get('thinkingBudget', 10000)
  };

  const finalChatId = chatId || require('uuid').v4();

  // Create AbortController for this generation
  const controller = new AbortController();
  generationControllers.set(finalChatId, controller);
  // Ensure we have models to try
  if (FREE_MODELS.length === 0) {
    await fetchFreeModels();
  }

  if (FREE_MODELS.length === 0) {
    event.reply('chat-stream', { event: 'error', data: { error: 'No models available. Check your internet connection.' }, chatId: finalChatId });
    return;
  }

  // Get or create conversation history
  let messages = conversationHistory.get(finalChatId) || [
    { role: 'system', content: getSystemPrompt() }
  ];

  // Add user message
  messages.push({ role: 'user', content: message });

  // Trim history if too long
  if (messages.length > MAX_HISTORY_LENGTH) {
    messages = [messages[0], ...messages.slice(-MAX_HISTORY_LENGTH + 1)];
  }

  // Save updated history
  conversationHistory.set(finalChatId, messages);

  // Build list of models to try
  const now = Date.now();
  const defaultModel = store.get('defaultModel') || FREE_MODELS[0].id;
  const preferredModel = model || defaultModel;
  const allModels = [preferredModel, ...FREE_MODELS.map(m => m.id).filter(m => m !== preferredModel)];
  const modelsToTry = allModels.filter(m => {
    const cooldownExpiry = rateLimitedModels.get(m);
    if (cooldownExpiry && now < cooldownExpiry) {
      console.log(`Skipping ${m} - still in cooldown`);
      return false;
    }
    if (cooldownExpiry) rateLimitedModels.delete(m);
    return true;
  });

  if (modelsToTry.length === 0) {
    modelsToTry.push(...allModels);
    rateLimitedModels.clear();
  }

  // Send meta event
  event.reply('chat-stream', { event: 'meta', data: { chat_id: finalChatId }, chatId: finalChatId });

  // Get tools for API
  const tools = getToolsForAPI();

  // Conversation loop (handles tool calls)
  let iterationCount = 0;
  const MAX_ITERATIONS = 30; // Prevent infinite loops

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;

    // Try each model
    let success = false;
    let responseData = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      const modelInfo = FREE_MODELS.find(m => m.id === currentModel);
      // Use model's max_completion_tokens, but ensure room for input (at least 10k tokens)
      const modelMaxOutput = modelInfo?.maxCompletionTokens || 4096;
      const contextLength = modelInfo?.contextLength || 32000;
      const maxTokens = Math.min(modelMaxOutput, contextLength - 10000, 65536);
      console.log(`[${finalChatId}] Trying model: ${currentModel} (max_tokens: ${maxTokens}, iteration ${iterationCount})`);

      try {
        // Check if this generation was cancelled
        if (generationControllers.has(finalChatId) && generationControllers.get(finalChatId).signal.aborted) {
          console.log(`[${finalChatId}] Generation was cancelled`);
          return;
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://akira.app',
            'X-Title': 'Akira Desktop'
          },
          body: JSON.stringify({
            model: currentModel,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: 'auto',
            max_tokens: maxTokens,
            temperature: settings.temperature,
            ...(settings.thinkingEnabled && {
              thinking: {
                type: 'enabled',
                budget_tokens: settings.thinkingBudget
              }
            })
          }),
          signal: controller.signal
        });

        if (response.status === 429 || response.status >= 500) {
          console.log(`Model ${currentModel} returned ${response.status}`);
          rateLimitedModels.set(currentModel, Date.now() + RATE_LIMIT_COOLDOWN_MS);
          if (i < modelsToTry.length - 1) continue;
          const errorText = await response.text();
          event.reply('chat-stream', { event: 'error', data: { error: `All free models are rate-limited. Please add a paid API key at https://openrouter.ai/settings/integrations to get higher limits.` }, chatId: finalChatId });
          return;
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`Model ${currentModel} error: ${errorText}`);
          if (i < modelsToTry.length - 1) continue;
          event.reply('chat-stream', { event: 'error', data: { error: errorText }, chatId: finalChatId });
          return;
        }

        responseData = await response.json();
        success = true;
        break;

      } catch (e) {
        console.log(`Model ${currentModel} failed: ${e.message}`);
        if (i < modelsToTry.length - 1) continue;
        event.reply('chat-stream', { event: 'error', data: { error: e.message }, chatId: finalChatId });
        return;
      }
    }

    if (!success || !responseData) {
      event.reply('chat-stream', { event: 'error', data: { error: 'Failed to get response from any model' }, chatId: finalChatId });
      return;
    }

    const choice = responseData.choices?.[0];
    if (!choice) {
      event.reply('chat-stream', { event: 'error', data: { error: 'Invalid response from model' }, chatId: finalChatId });
      return;
    }

    const assistantMessage = choice.message;

    // Check for tool calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Add assistant message with tool calls to history
      messages.push(assistantMessage);

      // Send tool use event to frontend
      const toolNames = assistantMessage.tool_calls.map(tc => tc.function.name);
      event.reply('chat-stream', { event: 'tool_use', data: { tools: toolNames }, chatId: finalChatId });

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs = {};

        try {
          toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          toolArgs = {};
        }

        console.log(`[${finalChatId}] Executing tool: ${toolName}`, toolArgs);

        const toolResult = await executeTool(toolName, toolArgs);

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });

        // Send tool result event
        event.reply('chat-stream', {
          event: 'tool_result',
          data: { tool: toolName, result: toolResult },
          chatId: finalChatId
        });
      }

      // Continue loop to get final response
      conversationHistory.set(finalChatId, messages);
      continue;
    }

    // No tool calls - this is the final response
    // Handle content - could be string or array of content blocks (for thinking)
    let content = '';
    let thinking = '';

    if (Array.isArray(assistantMessage.content)) {
      // Content blocks format (used by Claude with thinking)
      for (const block of assistantMessage.content) {
        if (block.type === 'thinking') {
          thinking = block.thinking || '';
        } else if (block.type === 'text') {
          content = block.text || '';
        }
      }
    } else {
      content = assistantMessage.content || '';
    }

    // Add to history
    messages.push({ role: 'assistant', content });
    conversationHistory.set(finalChatId, messages);

    // Auto-save to persistent storage
    saveChatToPersistent(finalChatId, messages);

    // Send thinking first if present
    if (thinking) {
      event.reply('chat-stream', { event: 'thinking', data: { thinking }, chatId: finalChatId });
    }

    // Stream the content (simulate streaming for non-streaming response)
    if (content) {
      // Send in chunks to simulate streaming
      const chunkSize = 20;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        event.reply('chat-stream', { event: 'delta', data: { delta: chunk }, chatId: finalChatId });
        await new Promise(r => setTimeout(r, 10)); // Small delay for smooth streaming
      }
    }
    // Cleanup controller
    generationControllers.delete(finalChatId);

    event.reply('chat-stream', {
      event: 'done',
      data: { chat_id: finalChatId, model: responseData.model || modelsToTry[0] },
      chatId: finalChatId
    });
    return;
  }

  // Max iterations reached
  // Cleanup controller
  generationControllers.delete(finalChatId);
  event.reply('chat-stream', {
    event: 'error',
    data: { error: 'Too many tool iterations. Please try again.' },
    chatId: finalChatId
  });
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
