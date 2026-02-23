import logging
from backend.core import memory_store

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "search_memories",
    "description": "Search long-term memories by keyword or phrase. Use before answering when context about the user, project, or past decisions would help.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search term or phrase to find in stored memories.",
            },
            "limit": {
                "type": "integer",
                "description": "Max number of memories to return (default 20).",
            },
        },
        "required": ["query"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    query = tool_input.get("query", "")
    limit = tool_input.get("limit", 20)
    try:
        limit = int(limit) if limit is not None else 20
        limit = max(1, min(100, limit))
    except (TypeError, ValueError):
        limit = 20
    memories = memory_store.search_memories(query, limit=limit)
    return 200, {"memories": memories, "count": len(memories)}
