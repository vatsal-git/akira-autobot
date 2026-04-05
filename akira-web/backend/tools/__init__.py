"""
Dynamic tool discovery: Python modules under backend/tools/ (including subpackages)
that define TOOL_DEF and call_tool are loaded as tools. Files and modules whose names
start with _ are skipped. Add new modules and call reload_tools (or restart) to register them.
"""
import importlib
import logging
import os
from typing import Any, Callable, Dict, List, Tuple

logger = logging.getLogger(__name__)


def discover_tools() -> Tuple[List[Dict[str, Any]], Dict[str, Callable]]:
    """
    Walk backend/tools for tool modules. Each module must define:
    - TOOL_DEF: dict with name, description, input_schema, default_enabled
    - call_tool(tool_input: dict, context=None) -> (status_code, result)

    Returns (list of tool definitions, dict of tool_name -> call_tool).
    """
    tools_def: List[Dict[str, Any]] = []
    handlers: Dict[str, Callable] = {}
    this_dir = os.path.dirname(os.path.abspath(__file__))

    for root, dirs, files in os.walk(this_dir):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            if name.startswith("_") or name == "__init__.py":
                continue
            full_path = os.path.join(root, name)
            rel_path = os.path.relpath(full_path, this_dir)
            module_rel = rel_path[:-3].replace(os.sep, ".")
            mod_name = f"backend.tools.{module_rel}"
            try:
                mod = importlib.import_module(mod_name)
            except Exception as e:
                logger.warning("Skipping tool module %s: %s", mod_name, e)
                continue
            if not hasattr(mod, "TOOL_DEF") or not hasattr(mod, "call_tool"):
                logger.warning("Tool module %s missing TOOL_DEF or call_tool", mod_name)
                continue
            td = getattr(mod, "TOOL_DEF")
            if not isinstance(td, dict) or "name" not in td:
                logger.warning("Tool module %s TOOL_DEF invalid", mod_name)
                continue
            tools_def.append(td)
            handlers[td["name"]] = getattr(mod, "call_tool")
            logger.debug("Loaded tool: %s (%s)", td["name"], mod_name)

    return tools_def, handlers
