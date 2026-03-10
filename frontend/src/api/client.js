/**
 * API base URL when running in Electron (set by preload) or from env. Empty = same origin / Vite proxy.
 * In production build, defaults to http://localhost:8000 so the app finds the backend.
 */
export function getApiBase() {
  if (typeof window !== 'undefined' && window.__AKIRA_API__) return window.__AKIRA_API__;
  const fromEnv = import.meta.env?.VITE_API_URL;
  if (fromEnv) return fromEnv;
  // Production build: no Vite proxy, so default to backend port 8000
  if (import.meta.env?.PROD) return 'http://localhost:8000';
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
