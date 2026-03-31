"""Screen size and pointer position (PyAutoGUI). Runs on the Akira server host."""
from backend.tools.desktop_control._desktop_control_core import call_desktop_tool

TOOL_DEF = {
    "name": "desktop_screen_query",
    "description": (
        "Read mouse position and virtual screen size, or capture a JPEG screenshot (base64 in the result for the UI). "
        "Use get_screen_size / get_mouse_position before pixel-based clicks from desktop_mouse or after desktop_ui_parse. "
        "Optional region for screenshot. Coordinates are OS screen pixels (top-left origin). Enable only when you trust this environment."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["get_mouse_position", "get_screen_size", "screenshot"],
                "description": "get_mouse_position returns x,y; get_screen_size returns width,height; screenshot returns JPEG base64.",
            },
            "region": {
                "type": "object",
                "properties": {
                    "left": {"type": "number"},
                    "top": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                },
                "description": "Optional rectangle for screenshot; omit for full screen.",
            },
        },
        "required": ["action"],
    },
    "default_enabled": False,
    "timeout_seconds": 300,
}


def call_tool(tool_input: dict, context=None):
    return call_desktop_tool("screen_query", tool_input, context)
