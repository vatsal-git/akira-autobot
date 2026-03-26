const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const isDev = Boolean(process.env.ELECTRON_START_URL);

function createWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 320,
    minHeight: 420,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    roundedCorners: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [isDev ? '--akira-dev' : '--akira-file'],
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('akira-window-minimize', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    w?.minimize();
  });
  ipcMain.handle('akira-window-close', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    w?.close();
  });
  ipcMain.handle('akira-toggle-always-on-top', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return false;
    const next = !w.isAlwaysOnTop();
    w.setAlwaysOnTop(next);
    return next;
  });
  ipcMain.handle('akira-is-always-on-top', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    return w ? w.isAlwaysOnTop() : false;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
