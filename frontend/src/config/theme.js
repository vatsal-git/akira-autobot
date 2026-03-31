/**
 * Appearance: light / dark. Sidebar emoji is stored locally (legacy migration from old named themes).
 */

const COLOR_KEYS = [
  'color-fg',
  'color-fg-muted',
  'color-bg',
  'color-bg-main',
  'color-bg-sidebar',
  'color-bg-elevated',
  'color-bg-subtle',
  'color-border',
  'color-bubble-user',
  'color-highlight',
  'color-secondary',
  'color-send-btn',
  'color-send-btn-hover',
  'color-primary',
  'color-primary-hover',
  'color-brand',
  'color-on-primary',
  'color-error',
  'color-error-bg',
];

const light = {
  'color-fg': '#333333',
  'color-fg-muted': '#454545',
  'color-bg': '#FFFFFF',
  'color-bg-main': '#FFFFFF',
  'color-bg-sidebar': '#F8F8F8',
  'color-bg-elevated': '#FAFAFA',
  'color-bg-subtle': '#F0F0F0',
  'color-border': '#CCCCCC',
  'color-bubble-user': '#F0F0F0',
  'color-highlight': '#CCCCCC',
  'color-secondary': '#6b6b6b',
  'color-send-btn': '#1a1a1a',
  'color-send-btn-hover': '#000000',
  'color-primary': '#1a1a1a',
  'color-primary-hover': '#000000',
  'color-brand': '#1a1a1a',
  'color-on-primary': '#ffffff',
  'color-error': '#CC0000',
  'color-error-bg': '#FFF0F0',
};

const dark = {
  'color-fg': '#E8E8E8',
  'color-fg-muted': '#999999',
  'color-bg': '#1A1A1A',
  'color-bg-main': '#222222',
  'color-bg-sidebar': '#2D2D2D',
  'color-bg-elevated': '#333333',
  'color-bg-subtle': '#3A3A3A',
  'color-border': '#444444',
  'color-bubble-user': '#3A3A3A',
  'color-highlight': '#555555',
  'color-secondary': '#888888',
  'color-send-btn': '#f0f0f0',
  'color-send-btn-hover': '#ffffff',
  'color-primary': '#f0f0f0',
  'color-primary-hover': '#ffffff',
  'color-brand': '#f0f0f0',
  'color-on-primary': '#141414',
  'color-error': '#FF6666',
  'color-error-bg': '#330000',
};

export const APPEARANCE_PRESETS = { light, dark };

export const APPEARANCE_LABELS = {
  light: 'Light',
  dark: 'Dark',
};

export const APPEARANCE_EMOJI = {
  light: '☀️',
  dark: '🌙',
};

const LEGACY_THEME_EMOJI = {
  anger: '😠',
  happy: '😊',
  calm: '😌',
  sad: '😢',
  tired: '😴',
  neutral: '😐',
  excited: '🤩',
  anxious: '😰',
  curious: '🤔',
  focused: '🎯',
  impressed: '😮',
  concerned: '😟',
  confused: '😕',
  thoughtful: '💭',
  amused: '😏',
  confident: '😎',
};

const DARK_LEGACY_NAMES = new Set([
  'anxious',
  'sad',
  'anger',
  'default_dark',
  'midnight',
  'energetic',
]);

const UI_STORAGE_KEY = 'akira_ui';
const LEGACY_THEME_KEY = 'akira_theme';

function readUi() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') return o;
  } catch (_) {}
  return null;
}

function migrateLegacyTheme() {
  try {
    const raw = localStorage.getItem(LEGACY_THEME_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    const name = (o.theme || '').trim();
    const appearance = DARK_LEGACY_NAMES.has(name) ? 'dark' : 'light';
    const emotionEmoji = LEGACY_THEME_EMOJI[name] || '✨';
    writeUi(mergeUiState({ appearance, emotionEmoji }));
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch (_) {}
}

function writeUi(state) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function normalizeBackgroundImage(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  if (typeof dataUrl !== 'string') return null;
  if (!dataUrl.startsWith('data:image/')) return null;
  return dataUrl;
}

function mergeUiState(partial) {
  const prev = readUi() || {};
  const appearance =
    partial.appearance !== undefined
      ? partial.appearance === 'dark'
        ? 'dark'
        : 'light'
      : prev.appearance === 'dark'
        ? 'dark'
        : prev.appearance === 'light'
          ? 'light'
          : 'light';
  const emotionEmoji =
    partial.emotionEmoji !== undefined
      ? clampEmoji(partial.emotionEmoji)
      : typeof prev.emotionEmoji === 'string' && prev.emotionEmoji.trim()
        ? prev.emotionEmoji.trim()
        : '✨';
  let backgroundImageDataUrl = partial.backgroundImageDataUrl;
  if (backgroundImageDataUrl === undefined) {
    backgroundImageDataUrl = prev.backgroundImageDataUrl ?? null;
  }
  backgroundImageDataUrl = normalizeBackgroundImage(backgroundImageDataUrl);
  return { appearance, emotionEmoji, backgroundImageDataUrl };
}

/**
 * Current appearance mode from the document.
 * @returns {'light'|'dark'|null}
 */
export function getCurrentAppearance() {
  const name = document.documentElement.getAttribute('data-appearance');
  return name === 'light' || name === 'dark' ? name : null;
}

/**
 * Emoji shown in the sidebar (from storage / last apply).
 * @returns {string}
 */
export function getCurrentEmotionEmoji() {
  const stored = getStoredUi();
  const e = stored?.emotionEmoji;
  return typeof e === 'string' && e.trim() ? e.trim() : '✨';
}

/**
 * @returns {{ appearance: 'light'|'dark', emotionEmoji: string } | null}
 */
export function getStoredUi() {
  migrateLegacyTheme();
  const o = readUi();
  if (!o) return null;
  const appearance = o.appearance === 'dark' ? 'dark' : o.appearance === 'light' ? 'light' : null;
  const emotionEmoji =
    typeof o.emotionEmoji === 'string' && o.emotionEmoji.trim() ? o.emotionEmoji.trim() : '✨';
  if (!appearance) return null;
  return { appearance, emotionEmoji };
}

/**
 * Apply light or dark color scheme.
 * @param {'light'|'dark'} mode
 * @param {boolean} persist
 * @returns {'light'|'dark'|null}
 */
export function applyAppearance(mode, persist = true) {
  const key = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : null;
  if (!key || !APPEARANCE_PRESETS[key]) return null;
  const root = document.documentElement;
  const colors = APPEARANCE_PRESETS[key];
  COLOR_KEYS.forEach((k) => {
    const value = colors[k];
    if (value != null) root.style.setProperty(`--${k}`, value);
  });
  root.setAttribute('data-appearance', key);

  if (persist) {
    migrateLegacyTheme();
    const existing = readUi();
    writeUi(
      mergeUiState({
        appearance: key,
        emotionEmoji:
          typeof existing?.emotionEmoji === 'string' && existing.emotionEmoji.trim()
            ? existing.emotionEmoji.trim()
            : '✨',
      })
    );
  }
  return key;
}

function clampEmoji(s) {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!t) return '✨';
  return [...t].slice(0, 16).join('');
}

/**
 * Set sidebar emoji (e.g. future picker or local-only updates).
 * @param {string} emoji
 * @param {boolean} persist
 * @returns {string} Applied emoji
 */
export function applyEmotion(emoji, persist = true) {
  const value = clampEmoji(emoji);
  if (persist) {
    migrateLegacyTheme();
    const prev = getStoredUi();
    const appearance = prev?.appearance ?? getCurrentAppearance() ?? 'light';
    writeUi(mergeUiState({ appearance, emotionEmoji: value }));
  }
  return value;
}

/**
 * Stored custom chat background (data URL), or null.
 * @returns {string|null}
 */
export function getStoredBackgroundImage() {
  migrateLegacyTheme();
  return normalizeBackgroundImage(readUi()?.backgroundImageDataUrl);
}

/**
 * Apply optional full-page chat background from a data URL (or clear when null).
 * @param {string|null} dataUrl
 * @param {boolean} persist
 * @returns {string|null} Applied value or null
 */
export function applyBackgroundImage(dataUrl, persist = true) {
  const value = normalizeBackgroundImage(dataUrl);
  const root = document.documentElement;
  if (value) {
    root.style.setProperty('--chat-bg-image', `url(${JSON.stringify(value)})`);
    root.setAttribute('data-chat-bg-image', '1');
  } else {
    root.style.removeProperty('--chat-bg-image');
    root.removeAttribute('data-chat-bg-image');
  }

  if (persist) {
    migrateLegacyTheme();
    writeUi(mergeUiState({ backgroundImageDataUrl: value }));
  }
  return value;
}

/**
 * Apply stored UI on load. Call once at app init.
 * @returns {'light'|'dark'|null}
 */
export function applyStoredTheme() {
  migrateLegacyTheme();
  const raw = readUi();
  const bg = normalizeBackgroundImage(raw?.backgroundImageDataUrl);
  const stored = getStoredUi();
  if (!stored) {
    applyAppearance('light', true);
    applyBackgroundImage(null, false);
    return 'light';
  }
  applyAppearance(stored.appearance, false);
  applyBackgroundImage(bg, false);
  return stored.appearance;
}

/** @deprecated Use applyStoredTheme — name kept for existing imports */
export const applyStoredAppearance = applyStoredTheme;

/** Backward-compat: old name for applyAppearance when given 'light'|'dark'. */
export function applyTheme(presetNameOrColors, persist = true) {
  if (typeof presetNameOrColors === 'string') {
    const k = presetNameOrColors.trim().toLowerCase();
    if (k === 'light' || k === 'dark') return applyAppearance(k, persist);
  }
  return null;
}

/** @deprecated Use getStoredUi */
export function getStoredTheme() {
  const u = getStoredUi();
  if (!u) return null;
  return { theme: u.appearance, emotionEmoji: u.emotionEmoji };
}

/** @deprecated Use getCurrentAppearance */
export function getCurrentThemeName() {
  return getCurrentAppearance();
}

/** @deprecated Use getCurrentEmotionEmoji */
export function getCurrentThemeEmoji() {
  return getCurrentEmotionEmoji();
}

export default APPEARANCE_PRESETS;
