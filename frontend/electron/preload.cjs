const { contextBridge, ipcRenderer } = require('electron');

const argv = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : [];
const isFileBuild = argv.includes('--akira-file');

if (isFileBuild) {
  const base = process.env.AKIRA_API_BASE || 'http://127.0.0.1:8002';
  contextBridge.exposeInMainWorld('__AKIRA_API__', base);
}

contextBridge.exposeInMainWorld('akiraDesktop', {
  minimize: () => ipcRenderer.invoke('akira-window-minimize'),
  close: () => ipcRenderer.invoke('akira-window-close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('akira-toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('akira-is-always-on-top'),
});
