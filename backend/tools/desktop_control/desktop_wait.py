"""Short pause during desktop automation. Runs on the Akira server host."""
from backend.tools.desktop_control._desktop_control_core import call_desktop_tool

TOOL_DEF = {
    "name": "desktop_wait",
    "description": (
        "Sleep up to 30 seconds on the Akira server between UI steps (animations, loads). "
        "Does not move the mouse; use sparingly. Enable only when you trust automation on this PC."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "seconds": {
                "type": "number",
                "description": "Duration to wait (0–30 seconds).",
            },
        },
        "required": ["seconds"],
    },
    "default_enabled": False,
    "timeout_seconds": 300,
}


def call_tool(tool_input: dict, context=None):
    return call_desktop_tool("wait", tool_input, context)
