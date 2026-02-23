"""
Cross-platform file locking and atomic write for history persistence.
"""
import os
import sys
import json
import logging
from contextlib import contextmanager
from typing import Any, Dict

logger = logging.getLogger(__name__)

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl


@contextmanager
def history_lock(file_path: str):
    """Acquire an exclusive lock on the history file (via .lock file). Release on exit."""
    lock_path = file_path + ".lock"
    try:
        f = open(lock_path, "wb")
    except OSError as e:
        logger.warning("Could not create lock file %s: %s", lock_path, e)
        yield
        return
    try:
        if sys.platform == "win32":
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        else:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if sys.platform == "win32":
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        finally:
            f.close()
            try:
                os.remove(lock_path)
            except OSError:
                pass


def load_history(file_path: str) -> Dict[str, Any]:
    """Load history from file. Caller should hold history_lock if doing read-modify-write."""
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_history_atomic(file_path: str, data: Dict[str, Any]) -> None:
    """Write data to file atomically (write to .tmp then rename). Caller should hold history_lock."""
    tmp_path = file_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, file_path)
