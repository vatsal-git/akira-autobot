"""
Desktop automation: mouse, keyboard, and screen capture via PyAutoGUI.
Runs on the machine where the Akira API process runs — enable only when you trust that environment.
"""
import base64
import logging
import time
from typing import Any, Dict, Optional, Tuple

from backend.core.screen_capture import screenshot_to_b64

logger = logging.getLogger(__name__)

try:
    import pyautogui
except ImportError:
    pyautogui = None

# Slightly faster than default 0.1s between actions; still safe for most UIs
if pyautogui is not None:
    pyautogui.PAUSE = 0.05
    pyautogui.FAILSAFE = True

TOOL_DEF = {
    "name": "desktop_control",
    "description": (
        "Controls the desktop on the machine running the Akira server (mouse, keyboard, scroll, drag, timing). "
        "Workflow: call get_screen_size (and often get_mouse_position) before pixel-based clicks; use screenshot "
        "for a JPEG of the screen in the tool result (compressed to fit context limits). "
        "Coordinates are OS screen pixels (origin top-left); DPI scaling and multi-monitor can affect accuracy—verify with "
        "a small region screenshot or desktop_ui grounding. PyAutoGUI fail-safe: moving the pointer into a screen corner aborts "
        "automation—avoid dragging through corners or use duration_seconds for smooth moves. "
        "When x,y are passed to click/double_click/right_click/middle_click, the pointer is always moved to that point first, then the click runs at the current cursor (no teleport-click in one OS call). "
        "Key names follow PyAutoGUI (e.g. enter, tab, esc, win, ctrl, alt). type_text is ASCII-oriented; use press_key/hotkey "
        "for special keys or non-ASCII. Enable only when you fully trust automated input on this PC."
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
                    "type_text",
                    "press_key",
                    "hotkey",
                    "scroll",
                    "drag",
                    "get_mouse_position",
                    "get_screen_size",
                    "screenshot",
                    "wait",
                ],
                "description": "Which operation to perform.",
            },
            "x": {
                "type": "number",
                "description": "Screen pixel X (move_mouse, click variants, optional; match get_screen_size width range).",
            },
            "y": {
                "type": "number",
                "description": "Screen pixel Y (move_mouse, click variants, optional; match get_screen_size height range).",
            },
            "start_x": {"type": "number", "description": "Drag start X."},
            "start_y": {"type": "number", "description": "Drag start Y."},
            "end_x": {"type": "number", "description": "Drag end X."},
            "end_y": {"type": "number", "description": "Drag end Y."},
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "description": "Mouse button for click (default left).",
            },
            "text": {"type": "string", "description": "Text to type (type_text); ASCII works reliably; use press_key for special keys."},
            "interval": {
                "type": "number",
                "description": "Seconds between keystrokes for type_text (default 0).",
            },
            "key": {
                "type": "string",
                "description": "Single key name for press_key (e.g. enter, backspace, volumeup).",
            },
            "keys": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Sequence for hotkey, e.g. [\"ctrl\", \"s\"].",
            },
            "scroll_amount": {
                "type": "integer",
                "description": "For scroll only: mouse wheel steps (positive = up, negative = down). Not for mouse clicks.",
            },
            "clicks": {
                "type": "integer",
                "description": "Deprecated alias for scroll_amount (scroll action only). Prefer scroll_amount.",
            },
            "duration_seconds": {
                "type": "number",
                "description": "Seconds: move_mouse / drag animation; optional animated move before click when x,y are set (then click at cursor).",
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
            "seconds": {
                "type": "number",
                "description": "Sleep duration for wait (max 30).",
            },
        },
        "required": ["action"],
    },
    "default_enabled": False,
    "timeout_seconds": 120,
}


def _ensure_pyautogui() -> Optional[str]:
    if pyautogui is None:
        return "PyAutoGUI is not installed. Add pyautogui to the server environment (pip install pyautogui)."
    return None


def _move_pointer_to(
    x: float, y: float, duration_seconds: Optional[float]
) -> None:
    """Move cursor to (x, y) so clicks can use position-only clicks at a known location."""
    assert pyautogui is not None
    if duration_seconds is not None:
        pyautogui.moveTo(float(x), float(y), duration=float(duration_seconds))
    else:
        pyautogui.moveTo(float(x), float(y))


def call_tool(tool_input: dict, context=None):
    err = _ensure_pyautogui()
    if err:
        return 500, {"error": err}

    action = tool_input.get("action")
    if not action or not isinstance(action, str):
        return 400, {"error": "Missing or invalid 'action'."}

    try:
        return _dispatch(action.strip().lower(), tool_input, context)
    except pyautogui.FailSafeException:
        return 500, {
            "error": "PyAutoGUI fail-safe triggered (pointer moved to a screen corner). Move the mouse away from corners or disable FAILSAFE in code.",
            "action": action,
        }
    except Exception as e:
        logger.exception("desktop_control failed: %s", action)
        return 500, {"error": str(e), "action": action}


def _dispatch(
    action: str, inp: Dict[str, Any], context=None
) -> Tuple[int, Dict[str, Any]]:
    assert pyautogui is not None

    if action == "get_mouse_position":
        p = pyautogui.position()
        return 200, {"x": p.x, "y": p.y}

    if action == "get_screen_size":
        s = pyautogui.size()
        return 200, {"width": s.width, "height": s.height}

    if action == "wait":
        sec = float(inp.get("seconds", 0))
        if sec < 0 or sec > 30:
            return 400, {"error": "seconds must be between 0 and 30."}
        time.sleep(sec)
        return 200, {"waited_seconds": sec}

    if action == "move_mouse":
        x = inp.get("x")
        y = inp.get("y")
        if x is None or y is None:
            return 400, {"error": "move_mouse requires x and y."}
        dur = inp.get("duration_seconds")
        _move_pointer_to(float(x), float(y), float(dur) if dur is not None else None)
        return 200, {"x": float(x), "y": float(y)}

    def _click_move_duration() -> Optional[float]:
        d = inp.get("duration_seconds")
        return float(d) if d is not None else None

    if action == "click":
        btn = inp.get("button") or "left"
        if btn not in ("left", "right", "middle"):
            return 400, {"error": "button must be left, right, or middle."}
        x, y = inp.get("x"), inp.get("y")
        if x is not None and y is not None:
            _move_pointer_to(float(x), float(y), _click_move_duration())
            pyautogui.click(button=btn)
            return 200, {"clicked": True, "x": float(x), "y": float(y), "button": btn}
        pyautogui.click(button=btn)
        p = pyautogui.position()
        return 200, {"clicked": True, "x": p.x, "y": p.y, "button": btn}

    if action == "double_click":
        x, y = inp.get("x"), inp.get("y")
        if x is not None and y is not None:
            _move_pointer_to(float(x), float(y), _click_move_duration())
            pyautogui.doubleClick()
            return 200, {"double_clicked": True, "x": float(x), "y": float(y)}
        pyautogui.doubleClick()
        p = pyautogui.position()
        return 200, {"double_clicked": True, "x": p.x, "y": p.y}

    if action == "right_click":
        x, y = inp.get("x"), inp.get("y")
        if x is not None and y is not None:
            _move_pointer_to(float(x), float(y), _click_move_duration())
            pyautogui.rightClick()
            return 200, {"right_clicked": True, "x": float(x), "y": float(y)}
        pyautogui.rightClick()
        p = pyautogui.position()
        return 200, {"right_clicked": True, "x": p.x, "y": p.y}

    if action == "middle_click":
        x, y = inp.get("x"), inp.get("y")
        if x is not None and y is not None:
            _move_pointer_to(float(x), float(y), _click_move_duration())
            pyautogui.middleClick()
            return 200, {"middle_clicked": True, "x": float(x), "y": float(y)}
        pyautogui.middleClick()
        p = pyautogui.position()
        return 200, {"middle_clicked": True, "x": p.x, "y": p.y}

    if action == "type_text":
        text = inp.get("text")
        if text is None:
            return 400, {"error": "type_text requires text."}
        interval = float(inp.get("interval") or 0)
        pyautogui.write(str(text), interval=interval)
        return 200, {"typed_length": len(str(text))}

    if action == "press_key":
        key = inp.get("key")
        if not key:
            return 400, {"error": "press_key requires key."}
        pyautogui.press(str(key))
        return 200, {"pressed": str(key)}

    if action == "hotkey":
        keys = inp.get("keys")
        if not keys or not isinstance(keys, list) or not all(isinstance(k, str) for k in keys):
            return 400, {"error": "hotkey requires keys as a non-empty array of strings."}
        pyautogui.hotkey(*keys)
        return 200, {"hotkey": keys}

    if action == "scroll":
        amount = inp.get("scroll_amount")
        if amount is None:
            amount = inp.get("clicks")
        if amount is None:
            return 400, {
                "error": "scroll requires scroll_amount (integer wheel steps: positive up, negative down).",
            }
        n = int(amount)
        pyautogui.scroll(n)
        return 200, {"scrolled": n, "scroll_amount": n}

    if action == "drag":
        sx = inp.get("start_x")
        sy = inp.get("start_y")
        ex = inp.get("end_x")
        ey = inp.get("end_y")
        if None in (sx, sy, ex, ey):
            return 400, {"error": "drag requires start_x, start_y, end_x, end_y."}
        dur = inp.get("duration_seconds")
        pyautogui.moveTo(float(sx), float(sy))
        if dur is not None:
            pyautogui.dragTo(float(ex), float(ey), duration=float(dur), button="left")
        else:
            pyautogui.dragTo(float(ex), float(ey), button="left")
        return 200, {
            "dragged": True,
            "start_x": float(sx),
            "start_y": float(sy),
            "end_x": float(ex),
            "end_y": float(ey),
        }

    if action == "screenshot":
        reg = inp.get("region")
        region_tuple = None
        if reg and isinstance(reg, dict):
            try:
                left = int(reg["left"])
                top = int(reg["top"])
                width = int(reg["width"])
                height = int(reg["height"])
                region_tuple = (left, top, width, height)
            except (KeyError, TypeError, ValueError):
                return 400, {"error": "region must include left, top, width, height as numbers."}
        try:
            from PIL import Image
        except ImportError:
            return 500, {
                "error": "Pillow is required for screenshots. Install with: pip install Pillow",
            }
        return screenshot_to_b64(
            pyautogui_module=pyautogui,
            image_module=Image,
            base64_module=base64,
            region=region_tuple,
        )

    return 400, {"error": f"Unknown action: {action}"}
