"""
Dynamic tool discovery: every .py file in this folder (except __init__.py and _*.py)
that defines TOOL_DEF and call_tool is loaded as a tool.
Add new .py files here and call reload_tools (or restart) to register them.
"""
import importlib
import logging
import os
from typing import Any, Callable, Dict, List, Tuple

logger = logging.getLogger(__name__)


def discover_tools() -> Tuple[List[Dict[str, Any]], Dict[str, Callable]]:
    """
    Scan this directory for tool modules. Each module must define:
    - TOOL_DEF: dict with name, description, input_schema, default_enabled
    - call_tool(tool_input: dict, context=None) -> (status_code, result)

    Returns (list of tool definitions, dict of tool_name -> call_tool).
    """
    tools_def: List[Dict[str, Any]] = []
    handlers: Dict[str, Callable] = {}
    this_dir = os.path.dirname(os.path.abspath(__file__))

    for name in sorted(os.listdir(this_dir)):
        if name.startswith("_") or name == "__init__.py" or not name.endswith(".py"):
            continue
        module_name = name[:-3]
        try:
            mod = importlib.import_module(f"backend.tools.{module_name}")
        except Exception as e:
            logger.warning("Skipping tool module %s: %s", module_name, e)
            continue
        if not hasattr(mod, "TOOL_DEF") or not hasattr(mod, "call_tool"):
            logger.warning("Tool module %s missing TOOL_DEF or call_tool", module_name)
            continue
        td = getattr(mod, "TOOL_DEF")
        if not isinstance(td, dict) or "name" not in td:
            logger.warning("Tool module %s TOOL_DEF invalid", module_name)
            continue
        tools_def.append(td)
        handlers[td["name"]] = getattr(mod, "call_tool")
        logger.debug("Loaded tool: %s", td["name"])

    return tools_def, handlers
