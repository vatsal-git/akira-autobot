const { contextBridge, ipcRenderer } = require('electron');

// Expose APIs to the renderer process
contextBridge.exposeInMainWorld('akira', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  hasApiKey: () => ipcRenderer.invoke('has-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),

  // Tools
  getToolsWithCategories: () => ipcRenderer.invoke('get-tools-with-categories'),

  // Window control
  switchCorner: (corner) => ipcRenderer.invoke('switch-corner', corner),
  toggleWidget: () => ipcRenderer.invoke('toggle-widget'),
  autoRelocate: () => ipcRenderer.invoke('auto-relocate'),
  setCollapsed: (collapsed) => ipcRenderer.invoke('set-collapsed', collapsed),
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', { deltaX, deltaY }),
  moveWindowDirection: (direction) => ipcRenderer.invoke('move-window-direction', direction),
  setWidgetMode: (mode) => ipcRenderer.invoke('set-widget-mode', mode),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),

  // Provider management
  getProviders: () => ipcRenderer.invoke('get-providers'),
  getProviderApiKey: (providerId) => ipcRenderer.invoke('get-provider-api-key', providerId),
  setProviderApiKey: (providerId, apiKey) => ipcRenderer.invoke('set-provider-api-key', { providerId, apiKey }),
  getSelectedProvider: () => ipcRenderer.invoke('get-selected-provider'),
  setSelectedProvider: (providerId) => ipcRenderer.invoke('set-selected-provider', providerId),
  getSelectedModel: () => ipcRenderer.invoke('get-selected-model'),
  setSelectedModel: (model) => ipcRenderer.invoke('set-selected-model', model),
  // Bedrock credentials
  getBedrockCredentials: () => ipcRenderer.invoke('get-bedrock-credentials'),
  setBedrockCredentials: (credentials) => ipcRenderer.invoke('set-bedrock-credentials', credentials),

  // Model-specific settings
  getModelSettings: (modelId) => ipcRenderer.invoke('get-model-settings', modelId),
  setModelSettings: (modelId, settings) => ipcRenderer.invoke('set-model-settings', modelId, settings),

  // Legacy: OpenRouter
  testConnection: (apiKey) => ipcRenderer.invoke('test-connection', apiKey),

  // Draft text persistence
  getDraftText: () => ipcRenderer.invoke('get-draft-text'),
  setDraftText: (text) => ipcRenderer.invoke('set-draft-text', text),

  // Clipboard file paths
  getClipboardFilePaths: () => ipcRenderer.invoke('get-clipboard-file-paths'),

  // Chat (uses send/on for streaming)
  sendMessage: (message, chatId, skipCache = false) => {
    ipcRenderer.send('send-message', { message, chatId, skipCache });
  },
  cancelGeneration: (chatId) => ipcRenderer.invoke('cancel-generation', chatId),
  clearChat: (chatId) => ipcRenderer.invoke('clear-chat', chatId),

  // Cache management
  getCacheStats: () => ipcRenderer.invoke('get-cache-stats'),
  clearResponseCache: () => ipcRenderer.invoke('clear-response-cache'),

  // Chat history
  getChatHistory: () => ipcRenderer.invoke('get-chat-history'),
  loadChat: (chatId) => ipcRenderer.invoke('load-chat', chatId),
  saveChat: (chatId, messages, title) => ipcRenderer.invoke('save-chat', { chatId, messages, title }),
  deleteChat: (chatId) => ipcRenderer.invoke('delete-chat', chatId),

  // Emergency stop and clarification responses
  submitEmergencyResponse: (response) => ipcRenderer.invoke('submit-emergency-response', response),
  submitClarificationResponse: (clarificationId, response) => ipcRenderer.invoke('submit-clarification-response', { clarificationId, response }),

  // Event listeners
  onChatStream: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('chat-stream', handler);
    return () => ipcRenderer.removeListener('chat-stream', handler);
  },

  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },

  onTrayExpand: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('tray-expand', handler);
    return () => ipcRenderer.removeListener('tray-expand', handler);
  },

  onCollapsedChanged: (callback) => {
    const handler = (event, collapsed) => callback(collapsed);
    ipcRenderer.on('collapsed-changed', handler);
    return () => ipcRenderer.removeListener('collapsed-changed', handler);
  },

  onWidgetModeChanged: (callback) => {
    const handler = (event, mode) => callback(mode);
    ipcRenderer.on('widget-mode-changed', handler);
    return () => ipcRenderer.removeListener('widget-mode-changed', handler);
  },

  onCommandOutput: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('command-output', handler);
    return () => ipcRenderer.removeListener('command-output', handler);
  },

  // Reset Akira
  resetAkira: () => ipcRenderer.invoke('reset-akira')
});
