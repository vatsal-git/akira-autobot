# Akira Desktop

Production desktop app for Akira. Same UI as the web frontend, uses the backend APIs.

## Prerequisites

- **Backend** must be running (e.g. `cd backend && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000` from project root).
- **Node.js** 18+ for building and running the app.

If `npm install` fails with **"self-signed certificate in certificate chain"** (common behind corporate proxies), run:

```bash
npm run install:insecure
```

That runs `npm install` with Node TLS verification disabled so Electron’s binary can download. Alternatively set the env var yourself then install:

- **Git Bash / WSL:** `export NODE_TLS_REJECT_UNAUTHORIZED=0` then `npm install`
- **PowerShell:** `$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm install`
- **Cmd:** `set NODE_TLS_REJECT_UNAUTHORIZED=0` then `npm install`

## Development

1. Start the backend (from project root):
   ```bash
   cd backend && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
   ```
2. From `desktop/` run the app against the Vite dev server (hot reload):
   ```bash
   cd desktop && npm install && npm run dev
   ```
   This starts the frontend dev server and launches Electron loading `http://localhost:5173`. The app will use `http://localhost:8000` for the API (set in preload).

## Production build

1. Build the frontend for Electron (relative base path) and the Electron app:
   ```bash
   cd desktop && npm install && npm run build
   ```
2. Installers go to `desktop/release/` (NSIS/portable on Windows, DMG on macOS, AppImage/deb on Linux).

To only build the frontend and run the packaged app without creating installers:
```bash
npm run build:frontend && npm start
```

## API URL

The desktop app talks to the backend at **http://localhost:8000** by default. To use a different URL (e.g. deployed backend), set before starting:

- **Windows (cmd):** `set AKIRA_API_URL=https://your-api.example.com`
- **Windows (PowerShell):** `$env:AKIRA_API_URL="https://your-api.example.com"`
- **macOS/Linux:** `AKIRA_API_URL=https://your-api.example.com npm start`

Then run the app from the same shell.

## Structure

- `electron-main.js` — main process: window, load frontend (dev URL or built `frontend/dist`).
- `preload.js` — exposes `window.__AKIRA_API__` so the frontend uses the backend API.
- Frontend is the same React app as the web; it detects desktop via `__AKIRA_API__` and uses it for all API calls and HashRouter for file-based loading.
