"""
Patch a range of lines in a text file. Use after read_file (with line numbers)
to change only that range instead of rewriting the whole file.
"""
import logging

from backend.core.file_access import atomic_write_text, is_write_allowed, resolve_path
from backend.core.python_syntax import is_python_source_file
from backend.core.source_syntax import is_syntax_checked_file, validate_source_syntax

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "patch_file",
    "description": "Replace a range of lines in a text file without rewriting the whole file. Use read_file with start_line/end_line and include_line_numbers to see the exact lines, then call patch_file with the same range and your new_content. Only lines start_line through end_line are replaced; the rest of the file is unchanged. Write is atomic. Prefer this over write_file when editing part of a file.",
    "input_schema": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file (relative to project root or absolute within project)",
            },
            "start_line": {
                "type": "integer",
                "description": "First line to replace (1-based, inclusive). Must match a line range you read with read_file.",
            },
            "end_line": {
                "type": "integer",
                "description": "Last line to replace (1-based, inclusive). Must be >= start_line.",
            },
            "new_content": {
                "type": "string",
                "description": "Exact content to put in place of the range. Use newlines for multiple lines; no line number prefix.",
            },
            "encoding": {
                "type": "string",
                "description": "Text encoding (default: utf-8)",
            },
        },
        "required": ["file_path", "start_line", "end_line", "new_content"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    file_path = tool_input.get("file_path", "").strip()
    start_line = tool_input.get("start_line")
    end_line = tool_input.get("end_line")
    new_content = tool_input.get("new_content", "")
    encoding = tool_input.get("encoding") or "utf-8"

    if start_line is None or end_line is None:
        return 200, {
            "success": False,
            "error": "start_line and end_line are required.",
            "path": file_path,
        }
    s, e = int(start_line), int(end_line)
    if s < 1 or e < s:
        return 200, {
            "success": False,
            "error": f"start_line must be >= 1 and end_line >= start_line (got start_line={s}, end_line={e}).",
            "path": file_path,
        }

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
        logger.warning("Patch blocked for %s: %s", file_path, err)
        return 200, {"success": False, "error": err, "path": str(resolved)}

    path_str = str(resolved)
    if not resolved.exists():
        return 200, {"success": False, "error": "File not found.", "path": path_str}
    if not resolved.is_file():
        return 200, {"success": False, "error": "Not a file.", "path": path_str}

    try:
        text = resolved.read_text(encoding=encoding)
    except UnicodeDecodeError as err:
        return 200, {
            "success": False,
            "error": f"File is not valid {encoding}: {err}",
            "path": path_str,
        }
    except OSError as err:
        logger.error("Error reading file %s: %s", path_str, err, exc_info=True)
        return 200, {"success": False, "error": str(err), "path": path_str}

    lines = text.splitlines(keepends=True)
    total = len(lines)
    if s > total or e > total:
        return 200, {
            "success": False,
            "error": f"Line range {s}-{e} is out of range; file has {total} lines.",
            "path": path_str,
            "total_lines": total,
        }

    # Replace lines [s-1:e] with new_content (0-based slice)
    before = lines[: s - 1]
    after = lines[e:]
    replacement = new_content
    if replacement and not replacement.endswith("\n") and after:
        replacement = replacement + "\n"
    new_text = "".join(before) + replacement + "".join(after)

    if is_syntax_checked_file(resolved):
        syn_err = validate_source_syntax(resolved, new_text)
        if syn_err:
            return 200, {"success": False, "error": syn_err, "path": path_str}

    try:
        atomic_write_text(resolved, new_text, encoding=encoding)
    except OSError as err:
        logger.error("Error writing file %s: %s", path_str, err, exc_info=True)
        return 200, {"success": False, "error": str(err), "path": path_str}

    logger.info("Patched file %s lines %s-%s", path_str, s, e)
    out = {
        "success": True,
        "path": path_str,
        "start_line": s,
        "end_line": e,
        "replaced_lines": e - s + 1,
        "filename": resolved.name,
    }
    if is_syntax_checked_file(resolved):
        out["syntax_ok"] = True
    if is_python_source_file(resolved):
        out["python_syntax_ok"] = True
    return 200, out
