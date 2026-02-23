import logging
from backend.core import memory_store

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "list_memories",
    "description": "List recent long-term memories. Use to see what has been stored or to get a quick overview.",
    "input_schema": {
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Max number of memories to return (default 20).",
            },
        },
        "required": [],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    limit = tool_input.get("limit", 20)
    try:
        limit = int(limit) if limit is not None else 20
        limit = max(1, min(100, limit))
    except (TypeError, ValueError):
        limit = 20
    memories = memory_store.list_memories(limit=limit)
    return 200, {"memories": memories, "count": len(memories)}
