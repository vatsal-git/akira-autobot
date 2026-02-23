import { apiFetch } from './client.js';

/**
 * @returns {Promise<Array<{ chat_id: string, title: string, created_at: string, last_updated: string, message_count: number }>>}
 */
export async function listChats() {
  const res = await apiFetch('/api/history');
  return res.json();
}

/**
 * @param {string} chatId
 * @returns {Promise<{ chat_id: string, created_at: string, messages: Array<{ role: string, content: string|Array, timestamp?: string }> }>}
 */
export async function getChat(chatId) {
  const res = await apiFetch(`/api/history/${chatId}`);
  return res.json();
}

/**
 * @param {string} chatId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteChat(chatId) {
  const res = await apiFetch(`/api/history/${chatId}`, { method: 'DELETE' });
  return res.json();
}
