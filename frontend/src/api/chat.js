import { apiFetch, getApiBase } from './client.js';

/**
 * Send a message and consume the SSE stream. Calls onMeta, onDelta, onSettings, onTheme, onDone, onError.
 * Pass signal from an AbortController to support cancelling (stop generating).
 * @param {{ message: string, chat_id?: string, images?: Array<{data: string, media_type: string}>, files?: Array<{name: string, data: string, mime_type: string}>, settings?: object }} body
 * @param {{ signal?: AbortSignal, onMeta: (data: { chat_id: string }) => void, onDelta: (delta: string) => void, onSettings?: (data: { temperature?: number, max_tokens?: number }) => void, onTheme?: (data: { theme: string }) => void, onDone: (data: { chat_id: string }) => void, onError: (data: { error: string, code?: string }) => void }} callbacks
 * @returns {Promise<void>}
 */
export async function sendMessage(body, { signal, onMeta, onDelta, onSettings, onTheme, onDone, onError }) {
  const base = getApiBase();
  const chatUrl = base ? `${base.replace(/\/$/, '')}/api/chat` : '/api/chat';
  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail || j.message || text;
    } catch (_) {}
    onError({ error: detail, code: 'request_failed' });
    return;
  }

  const reader = res.body.getReader(signal ? { signal } : undefined);
  const decoder = new TextDecoder();
  let buffer = '';

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
          else if (event === 'theme' && onTheme) onTheme(data);
          else if (event === 'done') onDone(data);
          else if (event === 'error') onError(data);
        } catch (e) {
          if (event === 'error') onError({ error: dataStr, code: 'parse_error' });
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      onDone({});
      return;
    }
    onError({ error: e.message || 'Stream ended unexpectedly', code: 'stream_error' });
  }
}
