import logging

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "reload_tools",
    "description": "Reload tools from backend/tools (including subfolders). Call this after creating or editing a tool module so Akira can use the new or updated tool without restarting the server.",
    "input_schema": {"type": "object", "properties": {}},
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    if context is None or not hasattr(context, "_reload_tools"):
        return 500, {"success": False, "error": "Reload not available (no context)."}
    try:
        context._reload_tools()
        return 200, {"success": True, "message": "Tools reloaded. New tools under backend/tools are now available."}
    except Exception as e:
        logger.exception("Failed to reload tools")
        return 500, {"success": False, "error": str(e)}
