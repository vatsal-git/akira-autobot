"""
Tool health check command.
Runs functional tests for all Akira tools and reports status.
"""
import logging
import os
import time
import tempfile
import uuid
from typing import Any, Dict, List, Tuple

from backend.core.command_handler import register_command

logger = logging.getLogger(__name__)


class HealthCheckResult:
    """Result of a single tool health check."""

    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"

    def __init__(self, tool_name: str):
        self.tool_name = tool_name
        self.status = self.SKIP
        self.message = ""
        self.details: Dict[str, Any] = {}
        self.duration_ms: float = 0

    def set_pass(self, message: str = "OK", **details):
        self.status = self.PASS
        self.message = message
        self.details = details

    def set_fail(self, message: str, **details):
        self.status = self.FAIL
        self.message = message
        self.details = details

    def set_skip(self, message: str, **details):
        self.status = self.SKIP
        self.message = message
        self.details = details

    def to_dict(self) -> dict:
        return {
            "tool": self.tool_name,
            "status": self.status,
            "message": self.message,
            "duration_ms": round(self.duration_ms, 2),
            "details": self.details,
        }


def _get_tool_handler(tool_name: str):
    """Get a tool handler by name."""
    try:
        from backend.tools import discover_tools
        _, handlers = discover_tools()
        return handlers.get(tool_name)
    except Exception as e:
        logger.error("Failed to discover tools: %s", e)
        return None


def _run_tool(tool_name: str, tool_input: dict, timeout: float = 30.0) -> Tuple[int, Any]:
    """Run a tool and return (status, result)."""
    handler = _get_tool_handler(tool_name)
    if handler is None:
        return 404, f"Tool '{tool_name}' not found"
    try:
        return handler(tool_input, None)
    except Exception as e:
        return 500, str(e)


# ============================================================================
# Individual tool health checks
# ============================================================================

def check_list_dir(result: HealthCheckResult):
    """Test list_dir: list current directory."""
    status, output = _run_tool("list_dir", {"dir_path": "."})
    if status == 200 and isinstance(output, dict) and output.get("success"):
        result.set_pass(f"Listed {len(output.get('entries', []))} entries")
    else:
        result.set_fail(f"Failed: {output}")


def check_read_file(result: HealthCheckResult):
    """Test read_file: read a known file."""
    # Try to read README.md or any .py file
    test_files = ["README.md", "backend/server.py", "backend/__init__.py"]
    for f in test_files:
        status, output = _run_tool("read_file", {"file_path": f})
        if status == 200 and isinstance(output, dict) and output.get("success"):
            result.set_pass(f"Read {f} ({output.get('size', 0)} bytes)")
            return
    result.set_fail("Could not read any test file")


def check_write_file(result: HealthCheckResult):
    """Test write_file: write and delete a temp file."""
    test_file = f".health_check_test_{uuid.uuid4().hex[:8]}.tmp"
    test_content = "Health check test content"
    try:
        # Write
        status, output = _run_tool("write_file", {
            "file_path": test_file,
            "content": test_content,
        })
        if status != 200 or not (isinstance(output, dict) and output.get("success")):
            result.set_fail(f"Write failed: {output}")
            return

        # Verify (disable line numbers to get raw content)
        status, output = _run_tool("read_file", {
            "file_path": test_file,
            "include_line_numbers": False,
        })
        if status != 200 or not (isinstance(output, dict) and output.get("success")):
            result.set_fail(f"Verify failed: {output}")
            return

        read_content = output.get("content", "").strip()
        if read_content != test_content:
            result.set_fail(f"Content mismatch: expected '{test_content}', got '{read_content}'")
            return

        result.set_pass("Write and verify succeeded")
    finally:
        # Cleanup
        try:
            from backend.core.file_access import resolve_path
            path = resolve_path(test_file)
            if path and path.exists():
                path.unlink()
        except Exception:
            pass


def check_patch_file(result: HealthCheckResult):
    """Test patch_file: skip (requires specific file state)."""
    # Patch requires a specific old content to replace
    # Just verify the handler exists
    handler = _get_tool_handler("patch_file")
    if handler:
        result.set_pass("Handler available (functional test skipped - requires specific file state)")
    else:
        result.set_fail("Handler not found")


def check_execute_command(result: HealthCheckResult):
    """Test execute_command: run echo."""
    status, output = _run_tool("execute_command", {"command": "echo health_check_test"})
    if status == 200:
        if isinstance(output, dict):
            stdout = output.get("stdout", "")
        else:
            stdout = str(output)
        if "health_check_test" in stdout:
            result.set_pass("Command executed successfully")
        else:
            result.set_fail(f"Unexpected output: {stdout[:100]}")
    else:
        result.set_fail(f"Command failed: {output}")


def check_reload_tools(result: HealthCheckResult):
    """Test reload_tools: verify handler and tool discovery."""
    # reload_tools requires LLM service context to actually reload
    # We test that discovery works instead
    handler = _get_tool_handler("reload_tools")
    if not handler:
        result.set_fail("Handler not found")
        return

    # Verify tool discovery works
    try:
        from backend.tools import discover_tools
        tools_def, handlers = discover_tools()
        result.set_pass(f"Handler available, {len(tools_def)} tools discoverable")
    except Exception as e:
        result.set_fail(f"Tool discovery failed: {e}")


def check_web_search(result: HealthCheckResult):
    """Test web_search: check API keys and make test query."""
    api_key = os.getenv("SEARCH_API_KEY")
    engine_id = os.getenv("SEARCH_ENGINE_ID")

    if not api_key:
        result.set_fail("Missing SEARCH_API_KEY environment variable")
        return
    if not engine_id:
        result.set_fail("Missing SEARCH_ENGINE_ID environment variable")
        return

    # Make a minimal test query
    status, output = _run_tool("web_search", {"query": "test", "results_count": 1})
    if status == 200 and isinstance(output, dict) and "search_results" in output:
        result.set_pass(f"API working, got {len(output.get('search_results', []))} results")
    else:
        result.set_fail(f"Search failed: {output}")


def check_fetch_webpage(result: HealthCheckResult):
    """Test fetch_webpage: fetch a known URL."""
    # Use httpbin which is reliable for testing
    status, output = _run_tool("fetch_webpage", {"url": "https://httpbin.org/html"})
    if status == 200:
        if isinstance(output, dict) and (output.get("success") or output.get("content")):
            result.set_pass("Fetched test URL successfully")
        elif isinstance(output, str) and len(output) > 50:
            result.set_pass("Fetched test URL successfully")
        else:
            result.set_fail(f"Unexpected response: {str(output)[:100]}")
    else:
        result.set_fail(f"Fetch failed (status {status}): {output}")


def check_camera_capture(result: HealthCheckResult):
    """Test camera_capture: check OpenCV and camera availability."""
    try:
        import cv2
    except ImportError:
        result.set_fail("OpenCV (cv2) not installed - pip install opencv-python")
        return

    # Try to open camera briefly without capturing
    try:
        import sys
        if sys.platform == "win32" and hasattr(cv2, "CAP_DSHOW"):
            cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        else:
            cap = cv2.VideoCapture(0)

        if cap.isOpened():
            cap.release()
            result.set_pass("Camera accessible (OpenCV + device OK)")
        else:
            result.set_fail("Camera not accessible - check device and permissions")
    except Exception as e:
        result.set_fail(f"Camera check error: {e}")


def check_store_memory(result: HealthCheckResult):
    """Test store_memory: store a test memory."""
    test_key = f"health_check_{uuid.uuid4().hex[:8]}"
    status, output = _run_tool("store_memory", {
        "key": test_key,
        "content": "Health check test memory",
        "tags": ["health_check", "test"],
    })
    if status == 200 and isinstance(output, dict) and output.get("success", True):
        result.set_pass("Memory stored successfully", memory_key=test_key)
    else:
        result.set_fail(f"Store failed: {output}")


def check_search_memories(result: HealthCheckResult):
    """Test search_memories: search for any memories."""
    status, output = _run_tool("search_memories", {"query": "test", "limit": 5})
    if status == 200 and isinstance(output, dict):
        count = len(output.get("results", output.get("memories", [])))
        result.set_pass(f"Search returned {count} results")
    else:
        result.set_fail(f"Search failed: {output}")


def check_list_memories(result: HealthCheckResult):
    """Test list_memories: list recent memories."""
    status, output = _run_tool("list_memories", {"limit": 5})
    if status == 200 and isinstance(output, dict):
        count = output.get("count", len(output.get("memories", [])))
        result.set_pass(f"Listed {count} memories")
    else:
        result.set_fail(f"List failed: {output}")


def check_desktop_mouse(result: HealthCheckResult):
    """Test desktop_mouse: check PyAutoGUI."""
    try:
        import pyautogui
    except ImportError:
        result.set_fail("PyAutoGUI not installed - pip install pyautogui")
        return

    # Get current position (non-destructive)
    try:
        pos = pyautogui.position()
        result.set_pass(f"PyAutoGUI OK, mouse at ({pos.x}, {pos.y})")
    except Exception as e:
        result.set_fail(f"PyAutoGUI error: {e}")


def check_desktop_keyboard(result: HealthCheckResult):
    """Test desktop_keyboard: check PyAutoGUI keyboard."""
    try:
        import pyautogui
    except ImportError:
        result.set_fail("PyAutoGUI not installed - pip install pyautogui")
        return

    # Just verify the module is available
    if hasattr(pyautogui, "typewrite") and hasattr(pyautogui, "hotkey"):
        result.set_pass("PyAutoGUI keyboard functions available")
    else:
        result.set_fail("PyAutoGUI keyboard functions missing")


def check_desktop_screen_query(result: HealthCheckResult):
    """Test desktop_screen_query: get screen size."""
    status, output = _run_tool("desktop_screen_query", {"action": "get_screen_size"})
    if status == 200 and isinstance(output, dict):
        w = output.get("width", output.get("screen_width"))
        h = output.get("height", output.get("screen_height"))
        if w and h:
            result.set_pass(f"Screen size: {w}x{h}")
        else:
            result.set_fail(f"No dimensions: {output}")
    else:
        result.set_fail(f"Query failed: {output}")


def check_desktop_ui_parse(result: HealthCheckResult):
    """Test desktop_ui_parse: check dependencies."""
    # This tool may use various backends (Windows UIA, etc.)
    handler = _get_tool_handler("desktop_ui_parse")
    if handler:
        # Just verify handler exists - actual parsing would require UI context
        result.set_pass("Handler available (UI context required for full test)")
    else:
        result.set_fail("Handler not found")


def check_desktop_wait(result: HealthCheckResult):
    """Test desktop_wait: verify handler exists."""
    handler = _get_tool_handler("desktop_wait")
    if handler:
        result.set_pass("Handler available")
    else:
        result.set_fail("Handler not found")


# ============================================================================
# Main health check orchestration
# ============================================================================

TOOL_CHECKS = {
    # File management
    "list_dir": check_list_dir,
    "read_file": check_read_file,
    "write_file": check_write_file,
    "patch_file": check_patch_file,
    # System tools
    "execute_command": check_execute_command,
    "reload_tools": check_reload_tools,
    # Internet search
    "web_search": check_web_search,
    "fetch_webpage": check_fetch_webpage,
    # Media devices
    "camera_capture": check_camera_capture,
    # Memory management
    "store_memory": check_store_memory,
    "search_memories": check_search_memories,
    "list_memories": check_list_memories,
    # Desktop control
    "desktop_mouse": check_desktop_mouse,
    "desktop_keyboard": check_desktop_keyboard,
    "desktop_screen_query": check_desktop_screen_query,
    "desktop_ui_parse": check_desktop_ui_parse,
    "desktop_wait": check_desktop_wait,
}


def run_all_health_checks(verbose: bool = False) -> Tuple[List[HealthCheckResult], Dict[str, int]]:
    """
    Run health checks for all tools.

    Returns:
        (results_list, summary_counts)
    """
    results = []
    summary = {HealthCheckResult.PASS: 0, HealthCheckResult.FAIL: 0, HealthCheckResult.SKIP: 0}

    for tool_name, check_func in TOOL_CHECKS.items():
        result = HealthCheckResult(tool_name)
        start = time.perf_counter()
        try:
            check_func(result)
        except Exception as e:
            logger.exception("Health check crashed for %s", tool_name)
            result.set_fail(f"Check crashed: {e}")
        result.duration_ms = (time.perf_counter() - start) * 1000
        results.append(result)
        summary[result.status] += 1

    return results, summary


def format_summary_table(results: List[HealthCheckResult], summary: Dict[str, int]) -> str:
    """Format results as a markdown summary table."""
    lines = [
        "## Tool Health Check Results\n",
        f"**Summary:** {summary['pass']} passed, {summary['fail']} failed, {summary['skip']} skipped\n",
        "| Tool | Status | Message |",
        "|------|--------|---------|",
    ]

    status_icons = {
        HealthCheckResult.PASS: "PASS",
        HealthCheckResult.FAIL: "FAIL",
        HealthCheckResult.SKIP: "SKIP",
    }

    for r in results:
        icon = status_icons.get(r.status, "?")
        # Truncate message for table
        msg = r.message[:60] + "..." if len(r.message) > 60 else r.message
        lines.append(f"| {r.tool_name} | {icon} | {msg} |")

    return "\n".join(lines)


def format_verbose_output(results: List[HealthCheckResult], summary: Dict[str, int]) -> str:
    """Format results with full details."""
    import json

    output = {
        "summary": {
            "total": len(results),
            "passed": summary[HealthCheckResult.PASS],
            "failed": summary[HealthCheckResult.FAIL],
            "skipped": summary[HealthCheckResult.SKIP],
        },
        "results": [r.to_dict() for r in results],
    }

    return "## Tool Health Check Results (Verbose)\n\n```json\n" + json.dumps(output, indent=2) + "\n```"


@register_command("tool-health-check", "Run functional health tests for all Akira tools")
def tool_health_check_command(args: str, context: dict):
    """
    Run health checks for all tools.

    Usage:
        /tool-health-check           - Summary table
        /tool-health-check verbose   - Detailed JSON output
        /tool-health-check -v        - Detailed JSON output
    """
    verbose = args.strip().lower() in ("verbose", "-v", "--verbose", "v")

    results, summary = run_all_health_checks(verbose=verbose)

    if verbose:
        output = format_verbose_output(results, summary)
    else:
        output = format_summary_table(results, summary)

    return 200, output
