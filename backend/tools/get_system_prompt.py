import logging

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "get_system_prompt",
    "description": "Read Akira's current system prompt (the instructions that define your personality and behavior). Use this to see what is in your system prompt before editing it.",
    "input_schema": {"type": "object", "properties": {}},
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    if context is not None and hasattr(context, "_get_system_prompt"):
        result = context._get_system_prompt()
        return 200, result
    return 500, {"success": False, "error": "System prompt not available (no context)."}
