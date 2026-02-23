const { contextBridge } = require('node:electron');

// Backend API base URL so the frontend can call the same APIs from the desktop app.
// Set by main process via env AKIRA_API_URL; default is applied in main and passed here would require
// ipc or a fixed default. We use a fixed default matching main (localhost:8000); override via env when building/running.
const API_BASE = process.env.AKIRA_API_URL || 'http://localhost:8000';

contextBridge.exposeInMainWorld('__AKIRA_API__', API_BASE);
