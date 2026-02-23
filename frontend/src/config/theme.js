/**
 * Theme config: presets and apply. Akira can change theme via set_theme tool; users can rely on mood-based presets.
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

/** Neutral / moodless — light, no strong mood */
const neutral = {
  'color-fg': '#0a0909',
  'color-fg-muted': '#44403c',
  'color-bg': '#e0d4ce',
  'color-bg-main': '#d4c4bc',
  'color-bg-sidebar': '#c4b0a6',
  'color-bg-elevated': '#f2ebe6',
  'color-bg-subtle': 'rgba(0,0,0,0.08)',
  'color-border': '#b8a399',
  'color-bubble-user': '#fff',
  'color-highlight': '#c8ff3d',
  'color-secondary': '#0369a1',
  'color-send-btn': '#a01d3a',
  'color-send-btn-hover': '#7f162f',
  'color-primary': '#a01d3a',
  'color-primary-hover': '#7f162f',
  'color-error': '#991b1b',
  'color-error-bg': '#fee2e2',
};

/** Anxious — dim, contained */
const anxious = {
  'color-fg': '#f5f0ed',
  'color-fg-muted': '#a39e9a',
  'color-bg': '#0f0d0d',
  'color-bg-main': '#050404',
  'color-bg-sidebar': '#1a1717',
  'color-bg-elevated': '#1f1c1c',
  'color-bg-subtle': 'rgba(255,255,255,0.08)',
  'color-border': '#3d3634',
  'color-bubble-user': '#2a2624',
  'color-highlight': '#b8ff4a',
  'color-secondary': '#0ea5e9',
  'color-send-btn': '#c92d4d',
  'color-send-btn-hover': '#e03a5c',
  'color-primary': '#c92d4d',
  'color-primary-hover': '#e03a5c',
  'color-error': '#f87171',
  'color-error-bg': '#7f1d1d',
};

/** Calm — rich blues */
const calm = {
  'color-fg': '#0f172a',
  'color-fg-muted': '#475569',
  'color-bg': '#dbeafe',
  'color-bg-main': '#bfdbfe',
  'color-bg-sidebar': '#93c5fd',
  'color-bg-elevated': '#eff6ff',
  'color-bg-subtle': 'rgba(0,0,0,0.06)',
  'color-border': '#60a5fa',
  'color-bubble-user': '#fff',
  'color-highlight': '#38bdf8',
  'color-secondary': '#0369a1',
  'color-send-btn': '#0369a1',
  'color-send-btn-hover': '#075985',
  'color-primary': '#0369a1',
  'color-primary-hover': '#075985',
  'color-error': '#b91c1c',
  'color-error-bg': '#fee2e2',
};

/** Anger — red, intense */
const anger = {
  'color-fg': '#1c1917',
  'color-fg-muted': '#44403c',
  'color-bg': '#fecaca',
  'color-bg-main': '#fca5a5',
  'color-bg-sidebar': '#f87171',
  'color-bg-elevated': '#fee2e2',
  'color-bg-subtle': 'rgba(0,0,0,0.08)',
  'color-border': '#ef4444',
  'color-bubble-user': '#fff',
  'color-highlight': '#f87171',
  'color-secondary': '#991b1b',
  'color-send-btn': '#b91c1c',
  'color-send-btn-hover': '#991b1b',
  'color-primary': '#b91c1c',
  'color-primary-hover': '#991b1b',
  'color-error': '#991b1b',
  'color-error-bg': '#fecaca',
};

/** Tired — minimal, stronger contrast */
const tired = {
  'color-fg': '#0a0a0a',
  'color-fg-muted': '#525252',
  'color-bg': '#f0f0f0',
  'color-bg-main': '#e5e5e5',
  'color-bg-sidebar': '#d4d4d4',
  'color-bg-elevated': '#fff',
  'color-bg-subtle': 'rgba(0,0,0,0.06)',
  'color-border': '#a3a3a3',
  'color-bubble-user': '#fff',
  'color-highlight': '#737373',
  'color-secondary': '#262626',
  'color-send-btn': '#171717',
  'color-send-btn-hover': '#0a0a0a',
  'color-primary': '#171717',
  'color-primary-hover': '#0a0a0a',
  'color-error': '#991b1b',
  'color-error-bg': '#fee2e2',
};

/** Happy — warm, saturated */
const happy = {
  'color-fg': '#1c1917',
  'color-fg-muted': '#57534e',
  'color-bg': '#ffedd5',
  'color-bg-main': '#fed7aa',
  'color-bg-sidebar': '#fdba74',
  'color-bg-elevated': '#fff7ed',
  'color-bg-subtle': 'rgba(0,0,0,0.06)',
  'color-border': '#f97316',
  'color-bubble-user': '#fff',
  'color-highlight': '#fbbf24',
  'color-secondary': '#c2410c',
  'color-send-btn': '#ea580c',
  'color-send-btn-hover': '#c2410c',
  'color-primary': '#ea580c',
  'color-primary-hover': '#c2410c',
  'color-error': '#b91c1c',
  'color-error-bg': '#fee2e2',
};

/** Sad — deep, saturated blue */
const sad = {
  'color-fg': '#f1f5f9',
  'color-fg-muted': '#94a3b8',
  'color-bg': '#0c1929',
  'color-bg-main': '#020617',
  'color-bg-sidebar': '#0f172a',
  'color-bg-elevated': '#1e293b',
  'color-bg-subtle': 'rgba(255,255,255,0.08)',
  'color-border': '#1e40af',
  'color-bubble-user': '#1e293b',
  'color-highlight': '#0ea5e9',
  'color-secondary': '#38bdf8',
  'color-send-btn': '#0284c7',
  'color-send-btn-hover': '#0369a1',
  'color-primary': '#0284c7',
  'color-primary-hover': '#0369a1',
  'color-error': '#f87171',
  'color-error-bg': '#7f1d1d',
};

/** Curious — deep indigo, exploratory */
const curious = {
  'color-fg': '#e2e2e2',
  'color-fg-muted': '#a0a0a0',
  'color-bg': '#1a1a2e',
  'color-bg-main': '#0f3460',
  'color-bg-sidebar': '#1a1a2e',
  'color-bg-elevated': '#16213e',
  'color-bg-subtle': 'rgba(114, 9, 183, 0.1)',
  'color-border': '#7209b7',
  'color-bubble-user': '#4361ee',
  'color-highlight': '#7209b7',
  'color-secondary': '#7209b7',
  'color-send-btn': '#4cc9f0',
  'color-send-btn-hover': '#4895ef',
  'color-primary': '#4cc9f0',
  'color-primary-hover': '#4895ef',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

/** Focused — deep teal, concentrated */
const focused = {
  'color-fg': '#e6f1ff',
  'color-fg-muted': '#8892b0',
  'color-bg': '#0a192f',
  'color-bg-main': '#1a365d',
  'color-bg-sidebar': '#0a192f',
  'color-bg-elevated': '#112240',
  'color-bg-subtle': 'rgba(100, 255, 218, 0.1)',
  'color-border': '#64ffda',
  'color-bubble-user': '#5eead4',
  'color-highlight': '#64ffda',
  'color-secondary': '#64ffda',
  'color-send-btn': '#64ffda',
  'color-send-btn-hover': '#5eead4',
  'color-primary': '#64ffda',
  'color-primary-hover': '#5eead4',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

/** Impressed — purple drama, bold */
const impressed = {
  'color-fg': '#f8edeb',
  'color-fg-muted': '#c8b6ff',
  'color-bg': '#240046',
  'color-bg-main': '#5a189a',
  'color-bg-sidebar': '#240046',
  'color-bg-elevated': '#3c096c',
  'color-bg-subtle': 'rgba(255, 124, 255, 0.1)',
  'color-border': '#ff7c7c',
  'color-bubble-user': '#e0aaff',
  'color-highlight': '#ff7c7c',
  'color-secondary': '#c8b6ff',
  'color-send-btn': '#ff7c7c',
  'color-send-btn-hover': '#ff9e9e',
  'color-primary': '#ff7c7c',
  'color-primary-hover': '#ff9e9e',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

/** Concerned — soft lavender, gentle */
const concerned = {
  'color-fg': '#4b2e83',
  'color-fg-muted': '#7a5fa7',
  'color-bg': '#f8f5ff',
  'color-bg-main': '#faf8ff',
  'color-bg-sidebar': '#f3eeff',
  'color-bg-elevated': '#fdfcff',
  'color-bg-subtle': 'rgba(147, 112, 219, 0.1)',
  'color-border': '#d8cbf7',
  'color-bubble-user': '#ece4ff',
  'color-highlight': '#9370db',
  'color-secondary': '#b39ddb',
  'color-send-btn': '#7e57c2',
  'color-send-btn-hover': '#9575cd',
  'color-primary': '#7e57c2',
  'color-primary-hover': '#9575cd',
  'color-error': '#d32f2f',
  'color-error-bg': '#ffebee',
};

/** Confused — muted mauve, uncertain */
const confused = {
  'color-fg': '#f1e8e6',
  'color-fg-muted': '#b0a4bc',
  'color-bg': '#352f44',
  'color-bg-main': '#6d6875',
  'color-bg-sidebar': '#352f44',
  'color-bg-elevated': '#5c5470',
  'color-bg-subtle': 'rgba(176, 164, 188, 0.2)',
  'color-border': '#b0a4bc',
  'color-bubble-user': '#b0a4bc',
  'color-highlight': '#e9b4cc',
  'color-secondary': '#e9b4cc',
  'color-send-btn': '#b0a4bc',
  'color-send-btn-hover': '#cebfd8',
  'color-primary': '#b0a4bc',
  'color-primary-hover': '#cebfd8',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

/** Thoughtful — slate and warm wood */
const thoughtful = {
  'color-fg': '#dcd7c9',
  'color-fg-muted': '#a9b2ac',
  'color-bg': '#2c3639',
  'color-bg-main': '#435b63',
  'color-bg-sidebar': '#2c3639',
  'color-bg-elevated': '#3f4e4f',
  'color-bg-subtle': 'rgba(169, 178, 172, 0.15)',
  'color-border': '#a9b2ac',
  'color-bubble-user': '#a9b2ac',
  'color-highlight': '#a27b5c',
  'color-secondary': '#a27b5c',
  'color-send-btn': '#a9b2ac',
  'color-send-btn-hover': '#c2ccc4',
  'color-primary': '#a9b2ac',
  'color-primary-hover': '#c2ccc4',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

/** Amused — dusky pink and lavender */
const amused = {
  'color-fg': '#f2e9e4',
  'color-fg-muted': '#c8b6ff',
  'color-bg': '#22223b',
  'color-bg-main': '#5a5d8f',
  'color-bg-sidebar': '#22223b',
  'color-bg-elevated': '#4a4e69',
  'color-bg-subtle': 'rgba(246, 195, 234, 0.15)',
  'color-border': '#f6c3ea',
  'color-bubble-user': '#c8b6ff',
  'color-highlight': '#f6c3ea',
  'color-secondary': '#c8b6ff',
  'color-send-btn': '#f6c3ea',
  'color-send-btn-hover': '#fad2f0',
  'color-primary': '#f6c3ea',
  'color-primary-hover': '#fad2f0',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

/** Confident — deep blue-green, assured */
const confident = {
  'color-fg': '#e0e1dd',
  'color-fg-muted': '#a5b3c7',
  'color-bg': '#1b263b',
  'color-bg-main': '#3a506b',
  'color-bg-sidebar': '#1b263b',
  'color-bg-elevated': '#2a3b5a',
  'color-bg-subtle': 'rgba(98, 195, 112, 0.1)',
  'color-border': '#62c370',
  'color-bubble-user': '#0096c7',
  'color-highlight': '#62c370',
  'color-secondary': '#0096c7',
  'color-send-btn': '#62c370',
  'color-send-btn-hover': '#76d085',
  'color-primary': '#62c370',
  'color-primary-hover': '#76d085',
  'color-error': '#ff5555',
  'color-error-bg': '#350815',
};

export const THEME_PRESETS = {
  anger,
  happy,
  calm,
  sad,
  tired,
  neutral,
  excited: anger,
  anxious,
  curious,
  focused,
  impressed,
  concerned,
  confused,
  thoughtful,
  amused,
  confident,
  // Backward compatibility: old preset names → same palettes
  default_light: neutral,
  default_dark: anxious,
  energetic: anger,
  focus: tired,
  cozy: happy,
  midnight: sad,
};

export const THEME_LABELS = {
  anger: 'Anger',
  happy: 'Happy',
  calm: 'Calm',
  sad: 'Sad',
  tired: 'Tired',
  neutral: 'Neutral',
  excited: 'Excited',
  anxious: 'Anxious',
  curious: 'Curious',
  focused: 'Focused',
  impressed: 'Impressed',
  concerned: 'Concerned',
  confused: 'Confused',
  thoughtful: 'Thoughtful',
  amused: 'Amused',
  confident: 'Confident',
};

/** Emoji for each emotion theme (shown in sidebar) */
export const THEME_EMOJI = {
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

/**
 * Current theme name from the document (set by applyTheme).
 * @returns {string|null}
 */
export function getCurrentThemeName() {
  return document.documentElement.getAttribute('data-theme') || null;
}

/**
 * Emoji for the current theme, or a default if unknown/custom.
 * @returns {string}
 */
export function getCurrentThemeEmoji() {
  const name = getCurrentThemeName();
  return (name && THEME_EMOJI[name]) ? THEME_EMOJI[name] : '✨';
}

const STORAGE_KEY = 'akira_theme';

/**
 * Apply a theme by preset name or by a partial colors object.
 * @param {string|Record<string, string>} presetNameOrColors - Preset key (e.g. 'calm') or object of CSS var values
 * @param {boolean} persist - If true, save to localStorage and used on next load
 * @returns {string} Applied theme name (for presets) or 'custom'
 */
export function applyTheme(presetNameOrColors, persist = true) {
  const root = document.documentElement;
  let themeName = 'custom';
  let colors = {};

  if (typeof presetNameOrColors === 'string') {
    const key = presetNameOrColors.trim();
    if (THEME_PRESETS[key]) {
      themeName = key;
      colors = { ...(THEME_PRESETS[key] || {}) };
    } else {
      return null;
    }
  } else if (typeof presetNameOrColors === 'object' && presetNameOrColors !== null) {
    colors = presetNameOrColors;
  } else {
    return null;
  }

  COLOR_KEYS.forEach((key) => {
    const value = colors[key];
    if (value != null) root.style.setProperty(`--${key}`, value);
  });
  root.setAttribute('data-theme', themeName);

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: themeName, colors: themeName === 'custom' ? colors : undefined }));
    } catch (_) {}
  }
  return themeName;
}

/**
 * Get the currently stored theme from localStorage (does not apply).
 * @returns {{ theme: string, colors?: Record<string, string> } | null}
 */
export function getStoredTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Apply stored theme on load. Call once at app init.
 */
export function applyStoredTheme() {
  const stored = getStoredTheme();
  if (!stored) return null;
  if (stored.theme && THEME_PRESETS[stored.theme]) {
    applyTheme(stored.theme, false);
    return stored.theme;
  }
  if (stored.colors && typeof stored.colors === 'object') {
    applyTheme(stored.colors, false);
    return 'custom';
  }
  return null;
}

export default THEME_PRESETS;
