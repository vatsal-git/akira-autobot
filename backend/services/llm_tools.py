import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Dict, Optional

from backend.tools import discover_tools

# If client settings still use legacy key desktop_control, map it to the split tools.
_DESKTOP_SPLIT_FROM_LEGACY = (
    "desktop_mouse",
    "desktop_keyboard",
    "desktop_screen_query",
    "desktop_ui_parse",
    "desktop_wait",
)


def _expand_legacy_desktop_control_enabled_map(
    enabled_tools_map,
):
    if not enabled_tools_map or not isinstance(enabled_tools_map, dict):
        return enabled_tools_map
    if "desktop_control" not in enabled_tools_map:
        return enabled_tools_map
    m = dict(enabled_tools_map)
    legacy_val = m.pop("desktop_control")
    if isinstance(legacy_val, bool):
        for name in _DESKTOP_SPLIT_FROM_LEGACY:
            m.setdefault(name, legacy_val)
    return m


# Single shared executor for running tool handlers with timeout (bounded pool to avoid unbounded threads)
_TOOL_EXECUTOR = ThreadPoolExecutor(max_workers=32, thread_name_prefix="tool_")


class LLM_Tools:
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        self._context = None
        self._tool_handlers: Dict[str, Any] = {}
        self._reload_tools()
        self.logger.info("Initializing LLM Tools: %s tools loaded", len(self.tools_def))

    def _reload_tools(self):
        """Load or reload tool definitions and handlers from backend/tools (recursive)."""
        self.tools_def, self._tool_handlers = discover_tools()
        self.tools_name_list = [t["name"] for t in self.tools_def]

    def _tool_timeout_seconds(
        self,
        tool_name: str,
        request_timeout: Optional[float],
        tool_input: Optional[dict] = None,
    ) -> Optional[float]:
        """Resolve effective timeout: request-level, per-tool TOOL_DEF timeout_seconds, then optional tool_input['timeout_seconds'] (LLM can pass per call)."""
        if request_timeout is not None and request_timeout > 0:
            timeout = request_timeout
        else:
            timeout = None
        for t in self.tools_def:
            if t.get("name") == tool_name and "timeout_seconds" in t:
                tool_limit = t.get("timeout_seconds")
                if isinstance(tool_limit, (int, float)) and tool_limit > 0:
                    if timeout is None:
                        timeout = float(tool_limit)
                    else:
                        timeout = min(timeout, float(tool_limit))
                break
        if tool_input:
            inp_sec = tool_input.get("timeout_seconds")
            if isinstance(inp_sec, (int, float)) and inp_sec > 0:
                cap = float(inp_sec)
                timeout = min(timeout, cap) if timeout is not None else cap
        return timeout

    def call_tool(
        self,
        tool_name: str,
        tool_input: dict,
        timeout_seconds: Optional[float] = None,
    ):
        """Execute a tool with optional timeout. timeout_seconds can be set per-request; tools may also define timeout_seconds in TOOL_DEF. When None, uses request-scoped _request_tool_timeout_seconds if set."""
        if timeout_seconds is None:
            timeout_seconds = getattr(self, "_request_tool_timeout_seconds", None)
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
            effective_timeout = self._tool_timeout_seconds(tool_name, timeout_seconds, tool_input)

            if effective_timeout is not None and effective_timeout > 0:
                future = _TOOL_EXECUTOR.submit(handler, tool_input, self._context)
                try:
                    status, tool_result = future.result(timeout=effective_timeout)
                except FuturesTimeoutError:
                    self.logger.warning("Tool %s timed out after %.1fs", tool_name, effective_timeout)
                    return 408, {
                        "error": f"Tool execution timed out after {effective_timeout:.0f} seconds.",
                        "tool": tool_name,
                        "timeout_seconds": effective_timeout,
                    }
            else:
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
        enabled_tools_map = _expand_legacy_desktop_control_enabled_map(enabled_tools_map)
        api_keys = ["name", "description", "input_schema"]
        if enabled_tools_map:
            return [
                {k: tool[k] for k in api_keys if k in tool}
                for tool in self.tools_def
                if enabled_tools_map.get(tool["name"], True)
            ]
        return [{k: tool[k] for k in api_keys if k in tool} for tool in self.tools_def]
