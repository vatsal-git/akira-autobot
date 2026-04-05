import { getApiBase } from './client.js';

/** Turn FastAPI / generic JSON error bodies into one readable string. */
function formatHttpErrorBody(status, statusText, text) {
  const raw = (text ?? '').trim();
  if (!raw) {
    if (status === 429) return 'Too many requests. Wait a minute and try again.';
    if (status === 401 || status === 403) return 'Not authorized to use the API.';
    if (status === 404) return 'API route not found. Check VITE_API_URL / proxy and backend routes.';
    if (status === 502 || status === 503 || status === 504)
      return `Server unreachable (HTTP ${status}). Start the backend on port 8100 or fix the Vite proxy target.`;
    return `HTTP ${status}${statusText ? ` ${statusText}` : ''}. No error details from server.`;
  }
  try {
    const j = JSON.parse(raw);
    const d = j.detail ?? j.message;
    if (typeof d === 'string' && d.trim()) return d.trim();
    if (Array.isArray(d) && d.length) {
      return d
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const loc = Array.isArray(item.loc) ? item.loc.join('.') : '';
            const msg = item.msg ?? item.message ?? '';
            return [loc, msg].filter(Boolean).join(': ') || JSON.stringify(item);
          }
          return String(item);
        })
        .join('; ');
    }
    if (d && typeof d === 'object') return JSON.stringify(d);
  } catch (_) {
    /* not JSON */
  }
  if (raw.startsWith('<!') || raw.toLowerCase().includes('<html')) {
    return `HTTP ${status}: received an HTML error page instead of JSON (proxy or server misconfiguration).`;
  }
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

/** Ensure UI always gets a non-empty error string (avoids generic fallbacks masking real issues). */
function coerceStreamError(data, fallbackCode) {
  const d = data && typeof data === 'object' ? { ...data } : {};
  let msg =
    (typeof d.error === 'string' && d.error.trim()) ||
    (typeof d.detail === 'string' && d.detail.trim()) ||
    (typeof d.message === 'string' && d.message.trim()) ||
    '';
  if (!msg && d.code === 'timeout') msg = 'Request timed out.';
  if (!msg) msg = 'Something went wrong. Try again.';
  return { ...d, error: msg, code: d.code || fallbackCode };
}

/**
 * Send a message and consume the SSE stream. Calls onMeta, onDelta, onSettings, onDone, onError.
 * Pass signal from an AbortController to support cancelling (stop generating).
 * @param {{ message: string, chat_id?: string, images?: Array<{data: string, media_type: string}>, files?: Array<{name: string, data: string, mime_type: string}>, settings?: { model?: string, temperature?: number, max_tokens?: number, thinking_enabled?: boolean, thinking_budget?: number, enabled_tools?: object, stream?: boolean, tool_timeout_seconds?: number }, error_recovery?: boolean }} body
 * @param {{ signal?: AbortSignal, onMeta: (data: { chat_id: string }) => void, onDelta: (delta: string) => void, onSettings?: (data: { temperature?: number, max_tokens?: number }) => void, onDone: (data: { chat_id: string }) => void, onError: (data: { error: string, code?: string }) => void }} callbacks
 * @returns {Promise<void>}
 */
export async function sendMessage(body, { signal, onMeta, onDelta, onSettings, onDone, onError }) {
  const base = getApiBase();
  const chatUrl = base ? `${base.replace(/\/$/, '')}/api/chat` : '/api/chat';
  let res;
  try {
    res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const hint =
      chatUrl.startsWith('/') && typeof window !== 'undefined'
        ? ' Start the backend (e.g. port 8100) so the Vite dev proxy can reach it.'
        : ' Check VITE_API_URL and that the backend is running.';
    onError(
      coerceStreamError(
        {
          error: `${e?.message || 'Network error'} (${chatUrl}).${hint}`,
          code: 'network_error',
        },
        'network_error'
      )
    );
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    const msg = formatHttpErrorBody(res.status, res.statusText, text);
    onError(
      coerceStreamError(
        { error: msg, code: 'request_failed', httpStatus: res.status },
        'request_failed'
      )
    );
    return;
  }

  const reader = res.body.getReader(signal ? { signal } : undefined);
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminalEvent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        if (!part.trim()) continue;
        let event = '';
        let dataStr = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
        }
        if (event === ':' || !dataStr) continue; // heartbeat or no data
        try {
          const data = JSON.parse(dataStr);
          if (event === 'meta') onMeta(data);
          else if (event === 'delta') onDelta(data.delta ?? '');
          else if (event === 'settings' && onSettings) onSettings(data);
          else if (event === 'done') {
            sawTerminalEvent = true;
            onDone(data);
          } else if (event === 'error') {
            sawTerminalEvent = true;
            onError(coerceStreamError(data, 'stream_error'));
          }
        } catch (e) {
          if (event === 'error') {
            sawTerminalEvent = true;
            onError(
              coerceStreamError(
                { error: dataStr || 'Invalid error payload from server.', code: 'parse_error' },
                'parse_error'
              )
            );
          }
        }
      }
    }
    if (!sawTerminalEvent && !(signal && signal.aborted)) {
      onError(
        coerceStreamError(
          {
            error:
              'The reply stopped before completion. Check your network, model or API limits, and backend logs.',
            code: 'incomplete_stream',
          },
          'incomplete_stream'
        )
      );
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      onDone({});
      return;
    }
    onError(
      coerceStreamError(
        {
          error: e.message || 'Stream ended unexpectedly',
          code: 'stream_error',
        },
        'stream_error'
      )
    );
  }
}
