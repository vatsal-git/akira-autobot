"""
List directory contents with metadata (name, type, size). Helps discover structure
without blind reads. Paths are canonicalized and restricted to the project workspace.
"""
import logging
from pathlib import Path

from backend.core.file_access import resolve_path

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "list_dir",
    "description": "List contents of a directory with name, type (file/dir), and size (files only). Use relative paths from the project root. Paths are canonicalized and must stay inside the project. Use to discover structure before read_file.",
    "input_schema": {
        "type": "object",
        "properties": {
            "dir_path": {
                "type": "string",
                "description": "Path to the directory (relative to project root or absolute within project). Use '.' or omit for project root.",
            },
            "max_entries": {
                "type": "integer",
                "description": "Maximum number of entries to return (default: 200). Use to limit output for large directories.",
            },
        },
        "required": [],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    dir_path = (tool_input.get("dir_path") or ".").strip()
    max_entries = tool_input.get("max_entries")
    if max_entries is not None:
        try:
            max_entries = max(1, int(max_entries))
        except (TypeError, ValueError):
            max_entries = 200
    else:
        max_entries = 200

    resolved = resolve_path(dir_path)
    if resolved is None:
        logger.warning("Rejected path outside workspace: %s", dir_path)
        return 200, {
            "success": False,
            "error": "Path is outside the project workspace.",
            "path": dir_path,
        }

    path_str = str(resolved)
    if not resolved.exists():
        return 200, {"success": False, "error": "Path not found.", "path": path_str}
    if not resolved.is_dir():
        return 200, {"success": False, "error": "Not a directory.", "path": path_str}

    try:
        entries = []
        for p in sorted(resolved.iterdir()):
            if len(entries) >= max_entries:
                entries.append({
                    "name": "...",
                    "type": "truncated",
                    "size": None,
                    "note": f"Limited to {max_entries} entries.",
                })
                break
            try:
                stat = p.stat()
                entry = {
                    "name": p.name,
                    "type": "dir" if p.is_dir() else "file",
                    "size": stat.st_size if p.is_file() else None,
                }
                entries.append(entry)
            except OSError:
                entries.append({"name": p.name, "type": "unknown", "size": None})

        logger.info("Listed directory: %s (%s entries)", path_str, len(entries))
        return 200, {
            "success": True,
            "path": path_str,
            "entries": entries,
        }
    except Exception as e:
        logger.error("Error listing %s: %s", path_str, e, exc_info=True)
        return 200, {"success": False, "error": str(e), "path": path_str}
