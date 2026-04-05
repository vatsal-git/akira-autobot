"""
Sandboxed file access for LLM tools: path canonicalization, workspace isolation,
and atomic writes. All paths are resolved and validated against WORKSPACE_ROOT
to prevent path traversal; writes use atomic replace where possible.
"""
import logging
import os
import shutil
from pathlib import Path
from typing import Optional

from backend.core.paths import WORKSPACE_ROOT, MAX_TEXT_FILE_SIZE

logger = logging.getLogger(__name__)

# Paths that are never writable (relative to workspace). Read-only for safety.
WRITE_BLOCKED_PREFIXES = (".git", "node_modules")


def resolve_path(file_path: str, allow_absolute: bool = True) -> Optional[Path]:
    """
    Resolve file_path to an absolute path under WORKSPACE_ROOT.
    Canonicalizes and enforces workspace boundary (path traversal safe).
    Returns None if the path would lie outside the workspace.
    """
    path = Path(file_path)
    if not path.is_absolute():
        path = (Path(WORKSPACE_ROOT) / path).resolve()
    else:
        path = path.resolve()
    try:
        path.relative_to(Path(WORKSPACE_ROOT).resolve())
    except (ValueError, TypeError):
        return None
    return path


def is_write_allowed(resolved: Path) -> tuple[bool, Optional[str]]:
    """
    Check if writing is allowed for this path. Returns (allowed, error_message).
    Blocks writes to .git, node_modules, etc. by default.
    """
    try:
        rel = resolved.relative_to(Path(WORKSPACE_ROOT).resolve())
        parts = rel.parts
        for prefix in WRITE_BLOCKED_PREFIXES:
            if parts and parts[0] == prefix:
                return False, f"Writing is not allowed under '{prefix}/'."
    except (ValueError, TypeError):
        return False, "Path is outside the project workspace."
    return True, None


def atomic_write_text(
    path: Path, content: str, encoding: str = "utf-8"
) -> None:
    """
    Write text to file atomically: write to path.tmp then replace.
    Avoids partial content on crash or interrupt.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(content, encoding=encoding)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write bytes to file atomically (tmp + replace)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def backup_if_exists(path: Path, backup_suffix: str = ".bak") -> Optional[Path]:
    """
    If path exists and is a file, copy it to path + backup_suffix and return backup path.
    Otherwise return None. Does not remove the original.
    """
    if not path.exists() or not path.is_file():
        return None
    backup = path.with_suffix(path.suffix + backup_suffix)
    shutil.copy2(path, backup)
    return backup
