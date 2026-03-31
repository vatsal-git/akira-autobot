"""
Shared desktop automation implementation (PyAutoGUI, screen parse).
Imported by desktop_mouse, desktop_keyboard, etc.; not loaded as a tool module.
"""
import base64
import logging
import time
from typing import Any, Dict, Optional, Tuple

from backend.core.screen_capture import screenshot_to_b64
from backend.core.screen_parse_session import store as _screen_parse_session_store

_MAX_RESOLVE_ELEMENT_IDS = 64

logger = logging.getLogger(__name__)

try:
    import pyautogui
except ImportError:
    pyautogui = None

if pyautogui is not None:
    pyautogui.PAUSE = 0.05
    pyautogui.FAILSAFE = True

_ALLOWED_ACTIONS = {
    "mouse": frozenset(
        {
            "move_mouse",
            "click",
            "double_click",
            "right_click",
            "middle_click",
            "scroll",
            "drag",
        }
    ),
    "keyboard": frozenset({"type_text", "press_key", "hotkey"}),
    "screen_query": frozenset({"get_mouse_position", "get_screen_size", "screenshot"}),
    "ui_parse": frozenset({"get_ui_elements", "get_ui_element_coords"}),
}


def _ensure_pyautogui() -> Optional[str]:
    if pyautogui is None:
        return "PyAutoGUI is not installed. Add pyautogui to the server environment (pip install pyautogui)."
    return None


def _move_pointer_to(
    x: float, y: float, duration_seconds: Optional[float]
) -> None:
    assert pyautogui is not None
    if duration_seconds is not None:
        pyautogui.moveTo(float(x), float(y), duration=float(duration_seconds))
    else:
        pyautogui.moveTo(float(x), float(y))


def call_desktop_tool(
    category: str,
    tool_input: dict,
    context=None,
):
    """Dispatch by category; validates action is allowed for that tool."""
    err = _ensure_pyautogui()
    if err:
        return 500, {"error": err}

    if not isinstance(tool_input, dict):
        return 400, {"error": "Tool input must be an object."}

    if category == "wait":
        try:
            sec = float(tool_input.get("seconds", 0))
        except (TypeError, ValueError):
            return 400, {"error": "seconds must be a number."}
        if sec < 0 or sec > 30:
            return 400, {"error": "seconds must be between 0 and 30."}
        try:
            return _dispatch("wait", {"action": "wait", "seconds": sec}, context)
        except pyautogui.FailSafeException:
            return 500, {
                "error": "PyAutoGUI fail-safe triggered (pointer moved to a screen corner). Move the mouse away from corners or disable FAILSAFE in code.",
                "action": "wait",
            }
        except Exception as e:
            logger.exception("desktop_wait failed")
            return 500, {"error": str(e), "action": "wait"}

    action = tool_input.get("action")
    if not action or not isinstance(action, str):
        return 400, {"error": "Missing or invalid 'action'."}
    a = action.strip().lower()
    allowed = _ALLOWED_ACTIONS.get(category)
    if allowed is None or a not in allowed:
        return 400, {
            "error": f"Invalid action for this tool: {action}. Allowed: {sorted(allowed or ())}.",
        }

    try:
        return _dispatch(a, tool_input, context)
    except pyautogui.FailSafeException:
        return 500, {
            "error": "PyAutoGUI fail-safe triggered (pointer moved to a screen corner). Move the mouse away from corners or disable FAILSAFE in code.",
            "action": action,
        }
    except Exception as e:
        logger.exception("desktop tool failed: %s", action)
        return 500, {"error": str(e), "action": action}


def _run_screen_parse_and_store(inp: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    """Capture screen, run OCR/OmniParser, scale bboxes to screen space, store session."""
    reg = inp.get("region")
    region_tuple = None
    offset_x, offset_y = 0, 0
    if reg and isinstance(reg, dict):
        try:
            offset_x = int(reg["left"])
            offset_y = int(reg["top"])
            width = int(reg["width"])
            height = int(reg["height"])
            region_tuple = (offset_x, offset_y, width, height)
        except (KeyError, TypeError, ValueError):
            return 400, {"error": "region must include left, top, width, height as numbers."}
    try:
        from PIL import Image
    except ImportError:
        return 500, {
            "error": "Pillow is required. Install with: pip install Pillow",
        }
    if region_tuple is not None:
        img = pyautogui.screenshot(region=region_tuple)
    else:
        img = pyautogui.screenshot()
    img = img.convert("RGB")
    cap_w, cap_h = img.size
    max_side = 1920
    parse_img = img
    sx = 1.0
    sy = 1.0
    if max(cap_w, cap_h) > max_side:
        ratio = max_side / float(max(cap_w, cap_h))
        nw = max(1, int(cap_w * ratio))
        nh = max(1, int(cap_h * ratio))
        parse_img = img.resize((nw, nh), Image.Resampling.LANCZOS)
        sx = cap_w / float(nw)
        sy = cap_h / float(nh)

    me = inp.get("max_elements")
    max_elements = 80 if me is None else min(200, max(1, int(me)))
    bt = inp.get("bbox_threshold")
    bbox_threshold = 0.05 if bt is None else float(bt)
    it = inp.get("iou_threshold")
    iou_threshold = 0.7 if it is None else float(it)

    pb = inp.get("parse_backend")
    if pb is not None and isinstance(pb, str):
        parse_backend = pb.strip().lower()
        if parse_backend not in ("easyocr", "omniparser", "auto"):
            return 400, {
                "error": "parse_backend must be easyocr, omniparser, or auto.",
            }
    else:
        parse_backend = "easyocr"

    try:
        from backend.core.screen_parse import run_screenshot_parse
    except ImportError as e:
        return 500, {"error": f"screen_parse unavailable: {e}"}

    elements, parser_id, perr = run_screenshot_parse(
        parse_img,
        parse_backend=parse_backend,
        bbox_threshold=bbox_threshold,
        iou_threshold=iou_threshold,
        max_elements=max_elements,
        max_label_len=160,
    )
    if perr:
        return 500, {"error": perr}
    for el in elements or []:
        b = el.get("bbox") or {}
        c = el.get("center") or {}
        bl = int(round(float(b.get("left", 0)) * sx)) + offset_x
        bt2 = int(round(float(b.get("top", 0)) * sy)) + offset_y
        br = int(round(float(b.get("right", 0)) * sx)) + offset_x
        bb = int(round(float(b.get("bottom", 0)) * sy)) + offset_y
        b["left"], b["top"], b["right"], b["bottom"] = bl, bt2, br, bb
        b["width"] = max(0, br - bl)
        b["height"] = max(0, bb - bt2)
        c["x"] = (bl + br) // 2
        c["y"] = (bt2 + bb) // 2

    note = "bbox and center are absolute screen pixels (region offset applied)."
    sid = _screen_parse_session_store.put(
        {
            "elements": elements or [],
            "parser": parser_id,
            "parse_backend": parse_backend,
            "capture_width": cap_w,
            "capture_height": cap_h,
            "screen_space_note": note,
        }
    )
    return 200, {
        "parse_session_id": sid,
        "elements": elements or [],
        "parser": parser_id,
        "parse_backend": parse_backend,
        "capture_width": cap_w,
        "capture_height": cap_h,
        "screen_space_note": note,
    }


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

    if action == "get_ui_elements":
        code, body = _run_screen_parse_and_store(inp)
        if code != 200:
            return code, body
        elements = body.get("elements") or []
        labels_lines: list[str] = []
        ids_out: list[Any] = []
        for el in elements:
            if not isinstance(el, dict):
                continue
            lab = str(el.get("label") or "").strip()
            if not lab:
                lab = "(unlabeled)"
            labels_lines.append(lab)
            ids_out.append(el.get("id"))
        return 200, {
            "parse_session_id": body["parse_session_id"],
            "labels_text": "\n".join(labels_lines),
            "element_ids": ids_out,
            "element_count": len(labels_lines),
            "parser": body["parser"],
            "parse_backend": body["parse_backend"],
            "capture_width": body["capture_width"],
            "capture_height": body["capture_height"],
            "screen_space_note": body["screen_space_note"],
        }

    if action == "get_ui_element_coords":
        sid = inp.get("parse_session_id")
        if not sid or not isinstance(sid, str):
            return 400, {"error": "get_ui_element_coords requires parse_session_id (string from get_ui_elements)."}
        raw_ids = inp.get("element_ids")
        if raw_ids is None or not isinstance(raw_ids, list) or not raw_ids:
            return 400, {
                "error": "get_ui_element_coords requires element_ids as a non-empty array of integers.",
            }
        if len(raw_ids) > _MAX_RESOLVE_ELEMENT_IDS:
            return 400, {
                "error": f"element_ids must have at most {_MAX_RESOLVE_ELEMENT_IDS} entries.",
            }
        want: list[int] = []
        for x in raw_ids:
            if isinstance(x, bool) or not isinstance(x, int):
                return 400, {"error": "Every element_ids entry must be an integer."}
            if x not in want:
                want.append(x)

        payload = _screen_parse_session_store.get(sid.strip())
        if payload is None:
            return 400, {
                "error": "Unknown or expired parse_session_id. Run get_ui_elements again.",
            }
        elements = payload.get("elements") or []
        by_id = {el.get("id"): el for el in elements if isinstance(el, dict)}
        missing = [i for i in want if i not in by_id]
        if missing:
            return 400, {
                "error": "Some element_ids are not in this parse session.",
                "invalid_element_ids": missing,
            }
        resolved = [by_id[i] for i in want]
        return 200, {
            "parse_session_id": sid.strip(),
            "elements": resolved,
            "screen_space_note": payload.get("screen_space_note", ""),
        }

    return 400, {"error": f"Unknown action: {action}"}
