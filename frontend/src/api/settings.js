import { apiFetch } from './client.js';

/**
 * @returns {Promise<{ max_tokens: number, temperature: number, current_model: string, thinking_enabled: boolean, thinking_budget: number, tools: Array<{ name: string, description: string, default_enabled: boolean }>, available_providers: string[] }>}
 */
export async function getSettings() {
  const res = await apiFetch('/api/settings');
  return res.json();
}
