import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Workspace root: project root (parent of backend/)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_ROOT = _BACKEND_DIR.parent

TOOL_DEF = {
    "name": "write_file",
    "description": "Write content to a file. Use relative paths from the project root (e.g. backend/tools/read_file.py). Overwrites by default; set append to true to add at the end. Parent directories are created if missing. Read the file first when editing so you don't overwrite blindly.",
    "input_schema": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file (relative to project root or absolute within project)",
            },
            "content": {
                "type": "string",
                "description": "Content to write (hex string if mode is 'binary')",
            },
            "mode": {
                "type": "string",
                "description": "File mode: 'text' or 'binary' (default: text)",
            },
            "append": {
                "type": "boolean",
                "description": "If true, append to the file instead of overwriting (default: false)",
            },
            "encoding": {
                "type": "string",
                "description": "Text encoding for text mode (default: utf-8)",
            },
        },
        "required": ["file_path", "content"],
    },
    "default_enabled": True,
}


def _resolve_path(file_path: str) -> Optional[Path]:
    """Resolve file_path to an absolute path under WORKSPACE_ROOT. Return None if outside."""
    path = Path(file_path)
    if not path.is_absolute():
        path = (WORKSPACE_ROOT / path).resolve()
    else:
        path = path.resolve()
    try:
        path.resolve().relative_to(WORKSPACE_ROOT)
    except ValueError:
        return None
    return path


def call_tool(tool_input: dict, context=None):
    file_path = tool_input.get("file_path", "").strip()
    content = tool_input.get("content", "")
    mode = (tool_input.get("mode") or "text").lower()
    append = tool_input.get("append", False)
    encoding = tool_input.get("encoding") or "utf-8"

    resolved = _resolve_path(file_path)
    if resolved is None:
        logger.warning("Rejected path outside workspace: %s", file_path)
        return 200, {
            "success": False,
            "error": "Path is outside the project workspace.",
            "path": file_path,
        }

    path_str = str(resolved)
    if resolved.exists() and resolved.is_dir():
        return 200, {"success": False, "error": "Path is a directory, not a file.", "path": path_str}

    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)

        if mode == "text":
            with open(resolved, "a" if append else "w", encoding=encoding) as f:
                f.write(content)
        elif mode == "binary":
            if append:
                with open(resolved, "ab") as f:
                    f.write(bytes.fromhex(content))
            else:
                resolved.write_bytes(bytes.fromhex(content))
        else:
            return 200, {
                "success": False,
                "error": f"Invalid mode: {mode}. Use 'text' or 'binary'.",
                "path": path_str,
            }

        size = resolved.stat().st_size
        logger.info("Successfully wrote to file: %s", path_str)
        return 200, {
            "success": True,
            "path": path_str,
            "size": size,
            "filename": resolved.name,
            "append": append,
        }
    except Exception as e:
        logger.error("Error writing to file %s: %s", path_str, e, exc_info=True)
        return 200, {"success": False, "error": str(e), "path": path_str}
