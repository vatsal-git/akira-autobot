import logging

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "edit_system_prompt",
    "description": "Edit Akira's system prompt. Replace the contents of akira_system_prompt.md with the new markdown text you provide. Changes take effect on the next message. Use get_system_prompt first to read the current prompt, then provide the full updated content.",
    "input_schema": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The new full system prompt content (markdown). This replaces the entire file.",
            },
        },
        "required": ["content"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    if context is None or not hasattr(context, "_edit_system_prompt"):
        return 500, {"success": False, "error": "Edit system prompt not available (no context)."}
    content = tool_input.get("content", "")
    return context._edit_system_prompt(content)
