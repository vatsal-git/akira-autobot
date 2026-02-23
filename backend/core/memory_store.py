"""
Long-term memory store for Akira. Persists memories to a JSON file with safe locking.
"""
import os
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.core.history_store import history_lock, load_history, save_history_atomic

logger = logging.getLogger(__name__)

# Same directory as other Akira data files
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEMORY_FILE = os.path.join(_BACKEND_DIR, "akira_memory.json")

# Top-level key in the JSON file
_MEMORIES_KEY = "memories"


def _ensure_list(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return the memories list from loaded data; default to empty list."""
    if not isinstance(data, dict):
        return []
    mem = data.get(_MEMORIES_KEY)
    if not isinstance(mem, list):
        return []
    return mem


def add_memory(
    content: str,
    category: Optional[str] = None,
    file_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Append a long-term memory. Uses file lock for safe concurrent access.
    Returns the created memory record (id, content, category, created_at).
    """
    path = file_path or MEMORY_FILE
    content = (content or "").strip()
    if not content:
        return {"success": False, "error": "content cannot be empty"}

    record = {
        "id": str(uuid.uuid4()),
        "content": content,
        "category": category or "",
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    with history_lock(path):
        data = load_history(path)
        memories = _ensure_list(data)
        memories.append(record)
        data[_MEMORIES_KEY] = memories
        save_history_atomic(path, data)

    logger.info("Stored long-term memory: id=%s", record["id"])
    return {"success": True, "memory": record}


def get_all_memories(
    file_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Load all memories (newest first). No lock needed for read-only."""
    path = file_path or MEMORY_FILE
    data = load_history(path)
    memories = _ensure_list(data)
    # Newest first
    return list(reversed(memories))


def search_memories(
    query: str,
    limit: int = 20,
    file_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search memories by substring match on content and category (case-insensitive).
    Returns up to `limit` matches, newest first.
    """
    path = file_path or MEMORY_FILE
    query = (query or "").strip().lower()
    if not query:
        return []

    data = load_history(path)
    memories = _ensure_list(data)
    matches = []
    for m in reversed(memories):
        content = (m.get("content") or "").lower()
        category = (m.get("category") or "").lower()
        if query in content or query in category:
            matches.append(m)
            if len(matches) >= limit:
                break
    return matches


def list_memories(
    limit: int = 20,
    file_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List the most recent memories, up to `limit` (default 20)."""
    path = file_path or MEMORY_FILE
    all_mem = get_all_memories(file_path=path)
    return all_mem[:limit]
