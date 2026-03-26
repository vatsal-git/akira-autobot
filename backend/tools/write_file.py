import logging
from pathlib import Path

from backend.core.file_access import (
    atomic_write_bytes,
    atomic_write_text,
    backup_if_exists,
    is_write_allowed,
    resolve_path,
)
from backend.core.python_syntax import is_python_source_file
from backend.core.source_syntax import is_syntax_checked_file, validate_source_syntax

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "write_file",
    "description": "Write content to a file. Use relative paths from the project root (e.g. backend/tools/read_file.py). Paths are canonicalized and must stay inside the project. Overwrites are done atomically (tmp then replace). Overwrites by default; set append to true to add at the end. Parent directories are created if missing. Read the file first when editing so you don't overwrite blindly. Writes to .git/ and node_modules/ are blocked.",
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
            "backup": {
                "type": "boolean",
                "description": "If true and overwriting an existing file, create a .bak copy first (default: false)",
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


def call_tool(tool_input: dict, context=None):
    file_path = tool_input.get("file_path", "").strip()
    content = tool_input.get("content", "")
    mode = (tool_input.get("mode") or "text").lower()
    append = tool_input.get("append", False)
    backup = tool_input.get("backup", False)
    encoding = tool_input.get("encoding") or "utf-8"

    resolved = resolve_path(file_path)
    if resolved is None:
        logger.warning("Rejected path outside workspace: %s", file_path)
        return 200, {
            "success": False,
            "error": "Path is outside the project workspace.",
            "path": file_path,
        }

    allowed, err = is_write_allowed(resolved)
    if not allowed:
        logger.warning("Write blocked for %s: %s", file_path, err)
        return 200, {"success": False, "error": err, "path": str(resolved)}

    path_str = str(resolved)
    if resolved.exists() and resolved.is_dir():
        return 200, {"success": False, "error": "Path is a directory, not a file.", "path": path_str}

    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)

        if mode == "text" and is_syntax_checked_file(resolved):
            if append and resolved.exists():
                try:
                    to_check = resolved.read_text(encoding=encoding) + content
                except UnicodeDecodeError as ude:
                    return 200, {
                        "success": False,
                        "error": f"Cannot validate source: file is not valid {encoding}: {ude}",
                        "path": path_str,
                    }
            else:
                to_check = content
            syn_err = validate_source_syntax(resolved, to_check)
            if syn_err:
                return 200, {"success": False, "error": syn_err, "path": path_str}

        if mode == "text":
            if append:
                with open(resolved, "a", encoding=encoding) as f:
                    f.write(content)
            else:
                if backup and resolved.exists():
                    backup_if_exists(resolved)
                atomic_write_text(resolved, content, encoding=encoding)
        elif mode == "binary":
            data = bytes.fromhex(content)
            if append:
                with open(resolved, "ab") as f:
                    f.write(data)
            else:
                if backup and resolved.exists():
                    backup_if_exists(resolved)
                atomic_write_bytes(resolved, data)
        else:
            return 200, {
                "success": False,
                "error": f"Invalid mode: {mode}. Use 'text' or 'binary'.",
                "path": path_str,
            }

        size = resolved.stat().st_size
        logger.info("Successfully wrote to file: %s", path_str)
        out = {
            "success": True,
            "path": path_str,
            "size": size,
            "filename": resolved.name,
            "append": append,
        }
        if mode == "text" and is_syntax_checked_file(resolved):
            out["syntax_ok"] = True
        if mode == "text" and is_python_source_file(resolved):
            out["python_syntax_ok"] = True
        return 200, out
    except Exception as e:
        logger.error("Error writing to file %s: %s", path_str, e, exc_info=True)
        return 200, {"success": False, "error": str(e), "path": path_str}
