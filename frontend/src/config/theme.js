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
  'color-error',
  'color-error-bg',
];

const light = {
  'color-fg': '#333333',
  'color-fg-muted': '#777777',
  'color-bg': '#FFFFFF',
  'color-bg-main': '#FFFFFF',
  'color-bg-sidebar': '#F8F8F8',
  'color-bg-elevated': '#FAFAFA',
  'color-bg-subtle': '#F0F0F0',
  'color-border': '#CCCCCC',
  'color-bubble-user': '#F0F0F0',
  'color-highlight': '#CCCCCC',
  'color-secondary': '#999999',
  'color-send-btn': '#CCCCCC',
  'color-send-btn-hover': '#DDDDDD',
  'color-primary': '#dc2438',
  'color-primary-hover': '#b81428',
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
  'color-send-btn': '#444444',
  'color-send-btn-hover': '#555555',
  'color-primary': '#dc2438',
  'color-primary-hover': '#b81428',
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
    writeUi({ appearance, emotionEmoji });
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch (_) {}
}

function writeUi(state) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
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
    writeUi({
      appearance: key,
      emotionEmoji:
        typeof existing?.emotionEmoji === 'string' && existing.emotionEmoji.trim()
          ? existing.emotionEmoji.trim()
          : '✨',
    });
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
    writeUi({ appearance, emotionEmoji: value });
  }
  return value;
}

/**
 * Apply stored UI on load. Call once at app init.
 * @returns {'light'|'dark'|null}
 */
export function applyStoredTheme() {
  migrateLegacyTheme();
  const stored = getStoredUi();
  if (!stored) {
    applyAppearance('light', true);
    return 'light';
  }
  applyAppearance(stored.appearance, false);
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
