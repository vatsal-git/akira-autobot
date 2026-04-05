"""Mouse and wheel automation (PyAutoGUI). Runs on the Akira server host."""
from backend.tools.desktop_control._desktop_control_core import call_desktop_tool

TOOL_DEF = {
    "name": "desktop_mouse",
    "description": (
        "Mouse and wheel on the machine running the Akira server: move, clicks, scroll, drag. "
        "Coordinates are OS screen pixels (top-left origin); DPI and multi-monitor can skew. "
        "Call desktop_screen_query (get_screen_size, get_mouse_position) before pixel-based moves. "
        "When x,y are set on click actions, the pointer moves there first (optional duration_seconds), then clicks. "
        "PyAutoGUI fail-safe: moving the pointer into a screen corner aborts automation—avoid dragging through corners. "
        "Enable only when you fully trust automated input on this PC."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "move_mouse",
                    "click",
                    "double_click",
                    "right_click",
                    "middle_click",
                    "scroll",
                    "drag",
                ],
                "description": "Which mouse operation to perform.",
            },
            "x": {
                "type": "number",
                "description": "Screen pixel X (move_mouse, click variants; optional for clicks = current position).",
            },
            "y": {"type": "number", "description": "Screen pixel Y."},
            "start_x": {"type": "number", "description": "Drag start X."},
            "start_y": {"type": "number", "description": "Drag start Y."},
            "end_x": {"type": "number", "description": "Drag end X."},
            "end_y": {"type": "number", "description": "Drag end Y."},
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "description": "Mouse button for click (default left).",
            },
            "scroll_amount": {
                "type": "integer",
                "description": "scroll: wheel steps (positive = up, negative = down).",
            },
            "clicks": {
                "type": "integer",
                "description": "Deprecated alias for scroll_amount (scroll only). Prefer scroll_amount.",
            },
            "duration_seconds": {
                "type": "number",
                "description": "move_mouse / drag animation; optional animated move before click when x,y are set.",
            },
        },
        "required": ["action"],
    },
    "default_enabled": False,
    "timeout_seconds": 300,
}


def call_tool(tool_input: dict, context=None):
    return call_desktop_tool("mouse", tool_input, context)
