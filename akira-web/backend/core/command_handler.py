"""
Command handler system for Akira.
Detects messages starting with '/' and routes to registered command handlers.
Commands are transient (not saved to chat history) and bypass the LLM.
"""
import logging
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Registry of command handlers: command_name -> (handler_func, description)
# Handler signature: (args: str, context: dict) -> (status_code, result_dict)
_COMMAND_REGISTRY: Dict[str, Tuple[Callable, str]] = {}


def register_command(name: str, description: str = ""):
    """Decorator to register a command handler."""
    def decorator(func: Callable[[str, dict], Tuple[int, dict]]):
        _COMMAND_REGISTRY[name.lower()] = (func, description)
        logger.debug("Registered command: /%s", name)
        return func
    return decorator


def is_command(message: str) -> bool:
    """Check if a message is a command (starts with /)."""
    return message.strip().startswith("/")


def parse_command(message: str) -> Tuple[Optional[str], str]:
    """
    Parse a command message into (command_name, args).
    Returns (None, "") if not a valid command.
    """
    message = message.strip()
    if not message.startswith("/"):
        return None, ""

    # Match /command-name or /command_name followed by optional args
    match = re.match(r"^/([a-zA-Z][a-zA-Z0-9_-]*)\s*(.*)", message, re.DOTALL)
    if not match:
        return None, ""

    cmd_name = match.group(1).lower()
    args = match.group(2).strip()
    return cmd_name, args


def get_command_handler(cmd_name: str) -> Optional[Callable]:
    """Get the handler function for a command."""
    entry = _COMMAND_REGISTRY.get(cmd_name.lower())
    return entry[0] if entry else None


def list_commands() -> List[Dict[str, str]]:
    """List all registered commands with descriptions."""
    return [
        {"name": name, "description": desc}
        for name, (_, desc) in sorted(_COMMAND_REGISTRY.items())
    ]


async def execute_command(message: str, context: Optional[dict] = None) -> Tuple[int, Dict[str, Any]]:
    """
    Execute a command message.

    Args:
        message: The raw message starting with /
        context: Optional context dict (llm_service, request, etc.)

    Returns:
        (status_code, result_dict) where result_dict has:
        - is_command: True
        - command: the command name
        - success: bool
        - result: command output or error
        - format: 'text' or 'markdown' (hint for rendering)
    """
    context = context or {}
    cmd_name, args = parse_command(message)

    if cmd_name is None:
        return 400, {
            "is_command": True,
            "command": None,
            "success": False,
            "result": "Invalid command format. Commands must start with / followed by a name.",
            "format": "text",
        }

    handler = get_command_handler(cmd_name)
    if handler is None:
        available = ", ".join(f"/{c}" for c in sorted(_COMMAND_REGISTRY.keys()))
        return 404, {
            "is_command": True,
            "command": cmd_name,
            "success": False,
            "result": f"Unknown command: /{cmd_name}\n\nAvailable commands: {available or '(none)'}",
            "format": "text",
        }

    try:
        logger.info("Executing command: /%s", cmd_name)
        status, result = handler(args, context)
        return status, {
            "is_command": True,
            "command": cmd_name,
            "success": status == 200,
            "result": result,
            "format": "markdown",
        }
    except Exception as e:
        logger.exception("Command /%s failed", cmd_name)
        return 500, {
            "is_command": True,
            "command": cmd_name,
            "success": False,
            "result": f"Command failed: {e}",
            "format": "text",
        }


# Import command modules to register them
def _load_commands():
    """Load all command modules."""
    try:
        from backend.core.commands import tool_health_check  # noqa: F401
    except ImportError as e:
        logger.warning("Failed to load tool_health_check command: %s", e)

    try:
        from backend.core.commands import help_cmd  # noqa: F401
    except ImportError as e:
        logger.warning("Failed to load help command: %s", e)


_load_commands()
