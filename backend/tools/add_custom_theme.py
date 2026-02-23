"""
Add a custom theme to the application. This allows creating a new theme with custom colors.
"""
import json
import logging
import os

from backend.core.paths import THEME_CONFIG_FILE
from backend.tools.set_theme import VALID_THEMES

logger = logging.getLogger(__name__)

# Path to store custom themes
CUSTOM_THEMES_FILE = os.path.join(os.path.dirname(THEME_CONFIG_FILE), "custom_themes.json")

TOOL_DEF = {
    "name": "add_custom_theme",
    "description": "Add a custom theme with specified colors. Creates a new theme that can be selected with set_theme.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name for the custom theme (e.g., 'sunset', 'forest', 'ocean')",
            },
            "colors": {
                "type": "object",
                "description": "Color definitions for the theme",
                "properties": {
                    "color-fg": {
                        "type": "string",
                        "description": "Foreground/text color (hex format)",
                    },
                    "color-fg-muted": {
                        "type": "string",
                        "description": "Muted text color (hex format)",
                    },
                    "color-bg": {
                        "type": "string",
                        "description": "Background color (hex format)",
                    },
                    "color-bg-main": {
                        "type": "string",
                        "description": "Main content background (hex format)",
                    },
                    "color-bg-sidebar": {
                        "type": "string",
                        "description": "Sidebar background (hex format)",
                    },
                    "color-bg-elevated": {
                        "type": "string",
                        "description": "Elevated elements background (hex format)",
                    },
                    "color-bg-subtle": {
                        "type": "string",
                        "description": "Subtle background color (rgba format)",
                    },
                    "color-border": {
                        "type": "string",
                        "description": "Border color (hex format)",
                    },
                    "color-bubble-user": {
                        "type": "string",
                        "description": "User message bubble color (hex format)",
                    },
                    "color-highlight": {
                        "type": "string",
                        "description": "Highlight color (hex format)",
                    },
                    "color-secondary": {
                        "type": "string",
                        "description": "Secondary accent color (hex format)",
                    },
                    "color-send-btn": {
                        "type": "string",
                        "description": "Send button color (hex format)",
                    },
                    "color-send-btn-hover": {
                        "type": "string",
                        "description": "Send button hover color (hex format)",
                    },
                    "color-primary": {
                        "type": "string",
                        "description": "Primary accent color (hex format)",
                    },
                    "color-primary-hover": {
                        "type": "string",
                        "description": "Primary accent hover color (hex format)",
                    },
                    "color-error": {
                        "type": "string",
                        "description": "Error text color (hex format)",
                    },
                    "color-error-bg": {
                        "type": "string",
                        "description": "Error background color (hex format)",
                    },
                }
            },
        },
        "required": ["name", "colors"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    theme_name = (tool_input.get("name") or "").strip()
    colors = tool_input.get("colors", {})
    
    if not theme_name:
        return 400, {
            "success": False,
            "error": "Theme name is required.",
        }
        
    if theme_name in VALID_THEMES:
        return 400, {
            "success": False,
            "error": f"Theme '{theme_name}' already exists as a built-in theme.",
        }
        
    # Load existing custom themes
    custom_themes = {}
    if os.path.exists(CUSTOM_THEMES_FILE):
        try:
            with open(CUSTOM_THEMES_FILE, "r", encoding="utf-8") as f:
                custom_themes = json.load(f)
        except json.JSONDecodeError:
            logger.warning("Custom themes file is corrupted, creating new one")
            custom_themes = {}
    
    # Add or update the custom theme
    custom_themes[theme_name] = colors
    
    # Save custom themes
    try:
        with open(CUSTOM_THEMES_FILE, "w", encoding="utf-8") as f:
            json.dump(custom_themes, f, indent=2)
        
        logger.info("Custom theme '%s' added", theme_name)
        return 200, {
            "success": True, 
            "message": f"Custom theme '{theme_name}' added successfully. To use it, update the frontend to include this theme.",
            "theme_name": theme_name,
            "note": "You'll need to modify the frontend code to use this theme."
        }
    except (OSError, IOError) as e:
        logger.error("Failed to write custom theme: %s", e)
        return 500, {"success": False, "error": str(e)}