import { apiFetch } from './client.js';

/**
 * @returns {Promise<{ theme: string }>}
 */
export async function getTheme() {
  const res = await apiFetch('/api/theme');
  return res.json();
}
