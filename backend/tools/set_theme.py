"""
Set the app's theme. Used by Akira to change the UI look based on user mood or preference.
"""
import json
import logging

from backend.core.paths import THEME_CONFIG_FILE

logger = logging.getLogger(__name__)

VALID_THEMES = [
    "anger",
    "happy",
    "calm",
    "sad",
    "tired",
    "neutral",
    "excited",
    "anxious",
    "curious",
    "focused",
    "impressed",
    "concerned",
    "confused",
    "thoughtful",
    "amused",
    "confident",
]

TOOL_DEF = {
    "name": "set_theme",
    "description": "Change the app's visual theme based on the user's (or your inferred) emotion. Use when the user shares how they feel or asks to change the look. Emotions: anger (intense red), happy (warm), calm (soft blue), sad (deep dark), tired (minimal grayscale), neutral (moodless, light), excited (bright punchy), anxious (dim, contained), curious (indigo, exploratory), focused (teal, concentrated), impressed (purple, bold), concerned (soft lavender), confused (muted mauve), thoughtful (slate, reflective), amused (dusky pink), confident (blue-green, assured). The UI updates immediately.",
    "input_schema": {
        "type": "object",
        "properties": {
            "theme": {
                "type": "string",
                "description": "Preset theme name.",
                "enum": VALID_THEMES,
            },
        },
        "required": ["theme"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    theme = (tool_input.get("theme") or "").strip()
    if theme not in VALID_THEMES:
        return 400, {
            "success": False,
            "error": f"Theme must be one of: {', '.join(VALID_THEMES)}.",
            "theme": None,
        }
    try:
        with open(THEME_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"theme": theme}, f, indent=2)
        logger.info("Theme set to %s", theme)
        return 200, {"success": True, "theme": theme, "message": f"Theme set to {theme}. The app will update to match."}
    except (OSError, IOError) as e:
        logger.error("Failed to write theme config: %s", e)
        return 500, {"success": False, "error": str(e), "theme": None}
