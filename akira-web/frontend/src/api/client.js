/**
 * API base URL when running in Electron (set by preload) or from env. Empty = same origin / Vite proxy.
 * When the app is served from the backend (e.g. desktop at 127.0.0.1:8100), use same origin to avoid CORS.
 */
const DEFAULT_API_PORT = '8100';
export function getApiBase() {
  if (typeof window !== 'undefined' && window.__AKIRA_API__) return window.__AKIRA_API__;
  const fromEnv = import.meta.env?.VITE_API_URL;
  if (fromEnv) return fromEnv;
  // Same origin: app served from backend (desktop or prod) — use relative URLs so no CORS
  if (typeof window !== 'undefined' && window.location?.origin) {
    const o = window.location.origin;
    if (o === `http://localhost:${DEFAULT_API_PORT}` || o === `http://127.0.0.1:${DEFAULT_API_PORT}`) return '';
  }
  // Production build with separate frontend host: point at backend
  if (import.meta.env?.PROD) return `http://localhost:${DEFAULT_API_PORT}`;
  return '';
}

/**
 * Base fetch for API calls. Uses getApiBase() in desktop; otherwise relative /api (Vite proxy).
 */
export async function apiFetch(path, options = {}) {
  const base = getApiBase();
  const pathStr = path.startsWith('/') ? path : `/api/${path}`;
  const url = base ? `${base.replace(/\/$/, '')}${pathStr}` : pathStr;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail || j.message || text;
    } catch (_) {}
    throw new Error(detail);
  }
  return res;
}
