const { contextBridge, ipcRenderer } = require('electron');

// Expose APIs to the renderer process
contextBridge.exposeInMainWorld('akira', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  hasApiKey: () => ipcRenderer.invoke('has-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),

  // Window control
  switchCorner: (corner) => ipcRenderer.invoke('switch-corner', corner),
  toggleWidget: () => ipcRenderer.invoke('toggle-widget'),
  autoRelocate: () => ipcRenderer.invoke('auto-relocate'),
  setCollapsed: (collapsed) => ipcRenderer.invoke('set-collapsed', collapsed),
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', { deltaX, deltaY }),
  setWidgetMode: (mode) => ipcRenderer.invoke('set-widget-mode', mode),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),

  // OpenRouter
  testConnection: (apiKey) => ipcRenderer.invoke('test-connection', apiKey),
  getModels: () => ipcRenderer.invoke('get-models'),
  refreshModels: () => ipcRenderer.invoke('refresh-models'),

  // Chat (uses send/on for streaming)
  sendMessage: (message, chatId, model) => {
    ipcRenderer.send('send-message', { message, chatId, model });
  },
  clearChat: (chatId) => ipcRenderer.invoke('clear-chat', chatId),

  // Chat history
  getChatHistory: () => ipcRenderer.invoke('get-chat-history'),
  loadChat: (chatId) => ipcRenderer.invoke('load-chat', chatId),
  saveChat: (chatId, messages, title) => ipcRenderer.invoke('save-chat', { chatId, messages, title }),
  deleteChat: (chatId) => ipcRenderer.invoke('delete-chat', chatId),

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
  }
});
