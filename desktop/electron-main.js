const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// Backend API URL (desktop talks to this). Default: local backend.
const API_BASE = process.env.AKIRA_API_URL || 'http://localhost:8000';

const isDev = process.argv.includes('--dev');

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Akira',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
    backgroundColor: '#EAE1DF',
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    const fs = require('node:fs');
    const distDir = path.join(__dirname, 'dist');
    const fallbackDir = path.join(__dirname, '..', 'frontend', 'dist');
    const indexHtml = fs.existsSync(path.join(distDir, 'index.html'))
      ? path.join(distDir, 'index.html')
      : path.join(fallbackDir, 'index.html');
    win.loadFile(indexHtml);
  }

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
