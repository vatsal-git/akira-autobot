/**
 * Overlay Preload Script
 * Exposes IPC channels for overlay communication
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  // Listen for border state changes (agent active/inactive)
  onBorder: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('overlay-border', handler);
    return () => ipcRenderer.removeListener('overlay-border', handler);
  },

  // Listen for action events (mouse/keyboard)
  onAction: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('overlay-action', handler);
    return () => ipcRenderer.removeListener('overlay-action', handler);
  },

  // Listen for screenshot region events
  onScreenshot: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('overlay-screenshot', handler);
    return () => ipcRenderer.removeListener('overlay-screenshot', handler);
  },

  // Listen for tool indicator events
  onTool: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('overlay-tool', handler);
    return () => ipcRenderer.removeListener('overlay-tool', handler);
  },

  // Listen for hide all command
  onHideAll: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('overlay-hide-all', handler);
    return () => ipcRenderer.removeListener('overlay-hide-all', handler);
  },

  // Listen for overlay hidden state changes
  onSetHidden: (callback) => {
    const handler = (event, hidden) => callback(hidden);
    ipcRenderer.on('overlay-set-hidden', handler);
    return () => ipcRenderer.removeListener('overlay-set-hidden', handler);
  },

  // Get initial hidden state
  getHiddenState: () => ipcRenderer.invoke('get-overlay-hidden-state')
});
