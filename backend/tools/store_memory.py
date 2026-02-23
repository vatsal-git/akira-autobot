import logging
from backend.core import memory_store

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "store_memory",
    "description": "Store a long-term memory for future recall. Use when the user shares something worth remembering: preferences, facts about them, project context, or decisions. Keep content concise and factual.",
    "input_schema": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The memory to store (e.g. 'User prefers dark mode', 'Project uses React 18').",
            },
            "category": {
                "type": "string",
                "description": "Optional category or tag (e.g. 'preferences', 'project', 'user').",
            },
        },
        "required": ["content"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    content = (tool_input.get("content") or "").strip()
    category = tool_input.get("category")
    result = memory_store.add_memory(content, category=category)
    if result.get("success"):
        return 200, result
    return 400, result
