import logging
from pathlib import Path
from typing import Optional

from backend.core.file_access import resolve_path
from backend.core.paths import MAX_TEXT_FILE_SIZE

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "read_file",
    "description": "Read content from a file. Use relative paths from the project root (e.g. backend/tools/file_management/read_file.py). Paths are canonicalized and must stay inside the project. For large text files, use start_line and end_line to read a range and avoid token limits. Text output can include line numbers to make edits easier.",
    "input_schema": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file (relative to project root or absolute within project)",
            },
            "start_line": {
                "type": "integer",
                "description": "First line to read (1-based, inclusive). Use with end_line for large files.",
            },
            "end_line": {
                "type": "integer",
                "description": "Last line to read (1-based, inclusive). Use with start_line for large files.",
            },
            "encoding": {
                "type": "string",
                "description": "Text encoding (default: utf-8). Use for non-UTF-8 files.",
            },
            "include_line_numbers": {
                "type": "boolean",
                "description": "Prepend 'N|' to each line for text files (default: true). Helps when editing.",
            },
        },
        "required": ["file_path"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    file_path = tool_input.get("file_path", "").strip()
    start_line = tool_input.get("start_line")
    end_line = tool_input.get("end_line")
    encoding = tool_input.get("encoding") or "utf-8"
    include_line_numbers = tool_input.get("include_line_numbers", True)

    resolved = resolve_path(file_path)
    if resolved is None:
        logger.warning("Rejected path outside workspace: %s", file_path)
        return 200, {
            "success": False,
            "error": "Path is outside the project workspace.",
            "path": file_path,
        }

    path_str = str(resolved)
    if not resolved.exists():
        return 200, {"success": False, "error": "File not found.", "path": path_str}
    if not resolved.is_file():
        return 200, {"success": False, "error": "Not a file.", "path": path_str}

    try:
        stats = resolved.stat()
        size = stats.st_size

        # Binary: read whole file as hex (line range not supported)
        try:
            raw = resolved.read_bytes()
        except OSError as e:
            logger.error("Error reading file %s: %s", path_str, e, exc_info=True)
            return 200, {"success": False, "error": str(e), "path": path_str}

        try:
            text_content = raw.decode(encoding)
            file_type = "text"
        except UnicodeDecodeError:
            content = raw.hex()
            logger.info("Successfully read file (binary): %s", path_str)
            return 200, {
                "success": True,
                "content": content,
                "file_type": "binary",
                "size": size,
                "path": path_str,
                "filename": resolved.name,
            }

        # Text: apply size guard and optional line range
        lines = text_content.splitlines(keepends=True)
        total_lines = len(lines)

        if start_line is not None or end_line is not None:
            s = max(1, start_line or 1)
            e = min(total_lines, end_line or total_lines)
            if s > e:
                return 200, {
                    "success": False,
                    "error": f"start_line ({s}) must be <= end_line ({e}). File has {total_lines} lines.",
                    "path": path_str,
                }
            lines = lines[s - 1 : e]
            line_info = {"start_line": s, "end_line": e, "total_lines": total_lines}
        else:
            if size > MAX_TEXT_FILE_SIZE:
                return 200, {
                    "success": False,
                    "error": f"File is large ({size} bytes, {total_lines} lines). Use start_line and end_line to read a range (e.g. 1–100).",
                    "path": path_str,
                    "size": size,
                    "total_lines": total_lines,
                }
            line_info = {"total_lines": total_lines}

        if include_line_numbers:
            base = (start_line or 1) if (start_line is not None or end_line is not None) else 1
            content = "".join(f"{base + i}|{line}" for i, line in enumerate(lines))
        else:
            content = "".join(lines)

        logger.info("Successfully read file: %s", path_str)
        return 200, {
            "success": True,
            "content": content,
            "file_type": file_type,
            "size": size,
            "path": path_str,
            "filename": resolved.name,
            **line_info,
        }
    except Exception as e:
        logger.error("Error reading file %s: %s", path_str, e, exc_info=True)
        return 200, {"success": False, "error": str(e), "path": path_str}
