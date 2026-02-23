import logging
from typing import Any, Dict

from backend.tools import discover_tools


class LLM_Tools:
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        self._context = None
        self._tool_handlers: Dict[str, Any] = {}
        self._reload_tools()
        self.logger.info("Initializing LLM Tools: %s tools loaded", len(self.tools_def))

    def _reload_tools(self):
        """Load or reload tool definitions and handlers from backend/tools folder."""
        self.tools_def, self._tool_handlers = discover_tools()
        self.tools_name_list = [t["name"] for t in self.tools_def]

    def call_tool(self, tool_name: str, tool_input: dict):
        self.logger.info("Calling tool: %s", tool_name)
        self.logger.debug("Tool input: %s", tool_input)

        try:
            if tool_name not in self._tool_handlers:
                error_msg = (
                    f"No such tool like {tool_name} found. "
                    f"Available tools: {self.tools_name_list}"
                )
                self.logger.warning(error_msg)
                return 500, error_msg

            handler = self._tool_handlers[tool_name]
            status, tool_result = handler(tool_input, self._context)

            self.logger.info("Tool %s completed with status %s", tool_name, status)
            self.logger.debug("Tool result: %s", tool_result)
            return status, tool_result

        except Exception as e:
            self.logger.error("Error in tool %s: %s", tool_name, e, exc_info=True)
            return 500, {"error": str(e), "tool": tool_name}

    def get_enabled_tools(self, enabled_tools_map=None):
        """Get the list of tools that are currently enabled.

        Args:
            enabled_tools_map: Optional dict mapping tool name -> bool.
                               When provided, only tools set to True are returned.
                               When None, all tools are returned.
        """
        api_keys = ["name", "description", "input_schema"]
        if enabled_tools_map:
            return [
                {k: tool[k] for k in api_keys if k in tool}
                for tool in self.tools_def
                if enabled_tools_map.get(tool["name"], True)
            ]
        return [{k: tool[k] for k in api_keys if k in tool} for tool in self.tools_def]
