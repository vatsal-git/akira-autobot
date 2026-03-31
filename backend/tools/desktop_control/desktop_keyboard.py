"""Keyboard automation (PyAutoGUI). Runs on the Akira server host."""
from backend.tools.desktop_control._desktop_control_core import call_desktop_tool

TOOL_DEF = {
    "name": "desktop_keyboard",
    "description": (
        "Keyboard input on the machine running the Akira server: type text, single keys, hotkeys. "
        "Key names follow PyAutoGUI (e.g. enter, tab, esc, win, ctrl, alt). "
        "type_text is ASCII-oriented; use press_key or hotkey for special keys or non-ASCII. "
        "Pair with windows_uia set_value when the accessibility tree is available. "
        "Enable only when you fully trust automated input on this PC."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["type_text", "press_key", "hotkey"],
                "description": "Which keyboard operation to perform.",
            },
            "text": {
                "type": "string",
                "description": "type_text: text to type; ASCII is most reliable.",
            },
            "interval": {
                "type": "number",
                "description": "Seconds between keystrokes for type_text (default 0).",
            },
            "key": {
                "type": "string",
                "description": "press_key: single key name (e.g. enter, backspace).",
            },
            "keys": {
                "type": "array",
                "items": {"type": "string"},
                "description": "hotkey: key sequence, e.g. [\"ctrl\", \"s\"].",
            },
        },
        "required": ["action"],
    },
    "default_enabled": False,
    "timeout_seconds": 300,
}


def call_tool(tool_input: dict, context=None):
    return call_desktop_tool("keyboard", tool_input, context)
