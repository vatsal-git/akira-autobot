/**
 * Custom themes loader - loads themes from the backend's custom_themes.json file
 */

/**
 * Fetches custom themes from the backend
 * @returns {Promise<Record<string, Record<string, string>>>} Custom themes object
 */
export async function fetchCustomThemes() {
  try {
    const response = await fetch('/api/custom-themes');
    if (!response.ok) {
      console.error('Failed to fetch custom themes:', response.statusText);
      return {};
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching custom themes:', error);
    return {};
  }
}

/**
 * Adds custom themes to the theme presets
 * @param {Record<string, Record<string, string>>} customThemes - Custom themes object
 * @param {Record<string, Record<string, string>>} themePresets - Existing theme presets
 * @param {Record<string, string>} themeLabels - Existing theme labels
 */
export function addCustomThemesToPresets(customThemes, themePresets, themeLabels) {
  Object.keys(customThemes).forEach(themeName => {
    themePresets[themeName] = customThemes[themeName];
    themeLabels[themeName] = `Custom: ${themeName}`;
  });
}