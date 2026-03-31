"""
Windows UI Automation via pywinauto (UIA backend). Windows only.
Stateless: each call resolves the target window and element from selectors.
"""
from __future__ import annotations

import logging
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_IS_WINDOWS = sys.platform == "win32"
_pywinauto = None

if _IS_WINDOWS:
    try:
        import pywinauto  # noqa: F401
        from pywinauto import Application, Desktop
        from pywinauto.base_wrapper import BaseWrapper

        _pywinauto = True
    except ImportError:
        _pywinauto = False
        Desktop = None  # type: ignore
        Application = None  # type: ignore
        BaseWrapper = None  # type: ignore
else:
    Desktop = None  # type: ignore
    Application = None  # type: ignore
    BaseWrapper = None  # type: ignore

MAX_WINDOWS = 50
MAX_TREE_DEPTH_DEFAULT = 12
MAX_TREE_NODES_DEFAULT = 200
MAX_NAME_LEN = 200
def _truncate(s: Optional[str], n: int = MAX_NAME_LEN) -> str:
    if s is None:
        return ""
    t = str(s).replace("\x00", "")
    if len(t) <= n:
        return t
    return t[: n - 3] + "..."


def _availability_error() -> Optional[str]:
    if not _IS_WINDOWS:
        return "windows_uia is only available on Windows."
    if not _pywinauto:
        return "pywinauto is not installed or failed to import. Install pywinauto on the server."
    return None


TOOL_DEF = {
    "name": "windows_uia",
    "description": (
        "Windows-only UI Automation: list top-level windows, dump a bounded accessibility tree, "
        "invoke (click) elements, set text on edits, or set focus. Prefer this over blind pixel clicks "
        "for native Win32/WPF apps when the tree is exposed. Coordinates in returned bounds are screen "
        "pixels (physical). invoke uses the UIA Invoke pattern when possible; otherwise click_input() "
        "moves the mouse and clicks. Pair with desktop_screen_query (screenshot), desktop_mouse (scroll), "
        "and desktop_keyboard (hotkeys). If this tool returns 404 or an empty tree, use desktop_ui_parse "
        "get_ui_elements or desktop_screen_query screenshot."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "list_windows",
                    "element_tree",
                    "invoke",
                    "set_value",
                    "set_focus",
                ],
                "description": "UIA operation.",
            },
            "handle": {
                "type": "integer",
                "description": "Native window handle (HWND) for window selection.",
            },
            "title_re": {
                "type": "string",
                "description": "Regex matched against window title (element_tree, invoke, set_value, set_focus).",
            },
            "process_name": {
                "type": "string",
                "description": "Executable name e.g. notepad.exe (connects by path/name).",
            },
            "pid": {
                "type": "integer",
                "description": "Process id to connect.",
            },
            "found_index": {
                "type": "integer",
                "description": "0-based index when multiple windows match title_re (default 0).",
            },
            "max_depth": {
                "type": "integer",
                "description": f"element_tree: max tree depth (default {MAX_TREE_DEPTH_DEFAULT}, max 24).",
            },
            "max_nodes": {
                "type": "integer",
                "description": f"element_tree: max nodes serialized (default {MAX_TREE_NODES_DEFAULT}, max 500).",
            },
            "root_automation_id": {
                "type": "string",
                "description": "element_tree: start below first descendant with this AutomationId.",
            },
            "root_name": {
                "type": "string",
                "description": "element_tree: start below first descendant whose name matches this substring.",
            },
            "automation_id": {
                "type": "string",
                "description": "Target element AutomationId (invoke, set_value, set_focus).",
            },
            "name": {
                "type": "string",
                "description": "Target element Name (optional; substring match unless name_re is true).",
            },
            "name_re": {
                "type": "boolean",
                "description": "If true, name is a regex (invoke, set_value, set_focus).",
            },
            "control_type": {
                "type": "string",
                "description": "UIA control type e.g. Button, Edit, Document (optional filter).",
            },
            "text": {
                "type": "string",
                "description": "set_value: text to apply.",
            },
        },
        "required": ["action"],
    },
    "default_enabled": False,
    "timeout_seconds": 120,
}


def call_tool(tool_input: dict, context=None):
    err = _availability_error()
    if err:
        return 501, {"error": err}

    action = tool_input.get("action")
    if not action or not isinstance(action, str):
        return 400, {"error": "Missing or invalid 'action'."}

    try:
        return _dispatch(action.strip().lower(), tool_input)
    except Exception as e:
        logger.exception("windows_uia failed: %s", action)
        return 500, {"error": str(e), "action": action}


def _get_desktop():
    from pywinauto import Desktop

    return Desktop(backend="uia")


def _resolve_window(inp: Dict[str, Any]) -> Tuple[Optional[Any], Optional[str]]:
    """Return (window_wrapper, error_message)."""
    from pywinauto import Application

    handle = inp.get("handle")
    if handle is not None:
        try:
            hwnd = int(handle)
            app = Application(backend="uia").connect(handle=hwnd)
            w = app.window(handle=hwnd)
            if not w.exists(timeout=2):
                return None, "Window handle not found or not responding."
            return w, None
        except Exception as e:
            return None, f"Could not connect to handle: {e}"

    pid = inp.get("pid")
    if pid is not None:
        try:
            app = Application(backend="uia").connect(process=int(pid))
            w = app.top_window()
            w.wait("exists ready", timeout=5)
            return w, None
        except Exception as e:
            return None, f"Could not connect to process pid: {e}"

    proc = inp.get("process_name")
    if proc:
        try:
            app = Application(backend="uia").connect(path=str(proc))
            w = app.top_window()
            w.wait("exists ready", timeout=5)
            return w, None
        except Exception as e:
            return None, f"Could not connect to process_name: {e}"

    title_re = inp.get("title_re")
    if title_re:
        try:
            idx = int(inp.get("found_index") or 0)
            desktop = _get_desktop()
            w = desktop.window(title_re=str(title_re), found_index=idx)
            w.wait("exists ready", timeout=5)
            return w, None
        except Exception as e:
            return None, f"No window matched title_re: {e}"

    return None, "Provide one of: handle, pid, process_name, or title_re."


def _control_type_str(wrapper: Any) -> str:
    try:
        ct = wrapper.element_info.control_type
        return str(ct)
    except Exception:
        return ""


def _serialize_bounds(wrapper: Any) -> Dict[str, int]:
    try:
        r = wrapper.rectangle()
        return {
            "left": int(r.left),
            "top": int(r.top),
            "right": int(r.right),
            "bottom": int(r.bottom),
        }
    except Exception:
        return {"left": 0, "top": 0, "right": 0, "bottom": 0}


def _walk_tree(
    wrapper: Any,
    depth: int,
    max_depth: int,
    counter: Dict[str, int],
    max_nodes: int,
) -> Optional[Dict[str, Any]]:
    if counter["n"] >= max_nodes:
        return None
    if depth > max_depth:
        return None

    counter["n"] += 1
    node: Dict[str, Any] = {
        "control_type": _truncate(_control_type_str(wrapper), 80),
        "name": _truncate(getattr(wrapper.element_info, "name", None) or ""),
        "automation_id": _truncate(
            getattr(wrapper.element_info, "automation_id", None) or ""
        ),
        "class_name": _truncate(getattr(wrapper.element_info, "class_name", None) or ""),
        "bounds": _serialize_bounds(wrapper),
    }
    try:
        node["is_enabled"] = bool(wrapper.is_enabled())
    except Exception:
        node["is_enabled"] = None
    try:
        node["has_keyboard_focus"] = bool(wrapper.has_keyboard_focus())
    except Exception:
        node["has_keyboard_focus"] = None

    children_out: List[Dict[str, Any]] = []
    if depth < max_depth and counter["n"] < max_nodes:
        try:
            kids = wrapper.children()
        except Exception:
            kids = []
        for ch in kids:
            if counter["n"] >= max_nodes:
                break
            sub = _walk_tree(ch, depth + 1, max_depth, counter, max_nodes)
            if sub is not None:
                children_out.append(sub)
    if children_out:
        node["children"] = children_out
    return node


def _find_subtree_root(window: Any, inp: Dict[str, Any]) -> Any:
    aid = inp.get("root_automation_id")
    if aid:
        try:
            el = window.child_window(auto_id=str(aid), control_type=None)
            el.wait("exists", timeout=3)
            return el
        except Exception:
            pass
        # walk shallow search
        try:
            for d in window.descendants():
                try:
                    if (d.element_info.automation_id or "") == str(aid):
                        return d
                except Exception:
                    continue
        except Exception:
            pass

    rname = inp.get("root_name")
    if rname:
        needle = str(rname).lower()
        try:
            for d in window.descendants():
                try:
                    n = (d.element_info.name or "").lower()
                    if needle in n:
                        return d
                except Exception:
                    continue
        except Exception:
            pass

    return window


def _name_matches(
    wrapper: Any,
    name: Optional[str],
    use_re: bool,
) -> bool:
    if not name:
        return True
    try:
        en = wrapper.element_info.name or ""
    except Exception:
        en = ""
    if use_re:
        try:
            return re.search(str(name), en, re.I) is not None
        except re.error:
            return False
    return str(name).lower() in en.lower()


def _find_target(window: Any, inp: Dict[str, Any]) -> Tuple[Optional[Any], Optional[str]]:
    aid = inp.get("automation_id")
    name = inp.get("name")
    name_re = bool(inp.get("name_re"))
    ctype = inp.get("control_type")

    def ok(w) -> bool:
        if aid is not None and str(aid) != (w.element_info.automation_id or ""):
            return False
        if not _name_matches(w, name if isinstance(name, str) else None, name_re):
            return False
        if ctype:
            if _control_type_str(w).lower() != str(ctype).lower():
                return False
        return True

    try:
        if aid and not name and not ctype:
            try:
                el = window.child_window(auto_id=str(aid))
                el.wait("exists", timeout=2)
                return el, None
            except Exception:
                pass

        for d in window.descendants():
            try:
                if ok(d):
                    return d, None
            except Exception:
                continue
        return None, "No element matched automation_id/name/control_type."
    except Exception as e:
        return None, str(e)


def _dispatch(action: str, inp: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    if action == "list_windows":
        from pywinauto import findwindows

        rows: List[Dict[str, Any]] = []
        try:
            elems = findwindows.find_elements(top_level_only=True)
        except Exception as e:
            return 500, {"error": str(e)}
        for el in elems[:MAX_WINDOWS]:
            try:
                if hasattr(el, "is_visible") and not el.is_visible():
                    continue
            except Exception:
                pass
            try:
                name = getattr(el, "name", None) or ""
                handle = int(getattr(el, "handle", 0) or 0)
                if not handle:
                    continue
                cn = getattr(el, "class_name", None) or ""
                rows.append(
                    {
                        "title": _truncate(name),
                        "handle": handle,
                        "class_name": _truncate(cn),
                    }
                )
            except Exception:
                continue
        return 200, {"windows": rows, "count": len(rows)}

    if action == "element_tree":
        w, err = _resolve_window(inp)
        if err:
            return 404, {"error": err}
        max_depth = min(int(inp.get("max_depth") or MAX_TREE_DEPTH_DEFAULT), 24)
        max_nodes = min(int(inp.get("max_nodes") or MAX_TREE_NODES_DEFAULT), 500)
        root = _find_subtree_root(w, inp)
        counter = {"n": 0}
        tree = _walk_tree(root, 0, max_depth, counter, max_nodes)
        return 200, {
            "tree": tree,
            "nodes_serialized": counter["n"],
            "truncated": counter["n"] >= max_nodes,
        }

    if action in ("invoke", "set_value", "set_focus"):
        w, err = _resolve_window(inp)
        if err:
            return 404, {"error": err}
        target, terr = _find_target(w, inp)
        if terr or target is None:
            return 404, {"error": terr or "Element not found."}

        if action == "invoke":
            try:
                target.invoke()
                return 200, {
                    "invoked": True,
                    "bounds": _serialize_bounds(target),
                    "via": "invoke_pattern",
                }
            except Exception:
                try:
                    target.click_input()
                    return 200, {
                        "invoked": True,
                        "bounds": _serialize_bounds(target),
                        "via": "click_input",
                    }
                except Exception as e:
                    return 500, {"error": f"invoke failed: {e}"}

        if action == "set_focus":
            try:
                target.set_focus()
                return 200, {"focused": True, "bounds": _serialize_bounds(target)}
            except Exception as e:
                return 500, {"error": f"set_focus failed: {e}"}

        if action == "set_value":
            text = inp.get("text")
            if text is None:
                return 400, {"error": "set_value requires text."}
            try:
                target.set_edit_text(str(text))
                return 200, {"set": True, "length": len(str(text))}
            except Exception:
                pass
            try:
                wv = target.get_value()
                _ = wv  # noqa: F841
            except Exception:
                pass
            try:
                target.type_keys("^a{BACKSPACE}", with_spaces=True)
                target.type_keys(str(text), with_spaces=True)
                return 200, {"set": True, "length": len(str(text)), "via": "type_keys"}
            except Exception as e:
                return 500, {"error": f"set_value failed: {e}"}

    return 400, {"error": f"Unknown action: {action}"}
