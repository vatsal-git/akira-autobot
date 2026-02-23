"""
Take a screenshot of the entire screen. Used by Akira to capture what the user is seeing.
"""
import logging
import os
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_ROOT = _BACKEND_DIR.parent
SCREENSHOTS_DIR = WORKSPACE_ROOT / "screenshots"

TOOL_DEF = {
    "name": "screenshot",
    "description": "Capture a screenshot of the entire screen (all monitors). Use when the user asks to see their screen, capture the display, or take a screenshot. The image is saved and a URL is returned so it can be shown in the chat.",
    "input_schema": {
        "type": "object",
        "properties": {
            "monitor": {
                "type": "integer",
                "description": "Which monitor: 1 = primary, 0 = all monitors combined, 2+ = secondary. Default 1.",
            },
        },
        "required": [],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    monitor = tool_input.get("monitor", 1)
    try:
        import mss
    except ImportError:
        logger.error("mss not installed. pip install mss")
        return 500, {
            "success": False,
            "error": "Screenshot support not installed. Install with: pip install mss",
            "path": None,
            "url": None,
        }

    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"screenshot_{timestamp}.png"
    filepath = SCREENSHOTS_DIR / filename

    try:
        with mss.mss() as sct:
            # mon: 0 = all, 1 = first, 2 = second, ...
            sct.shot(mon=monitor, output=str(filepath))
    except Exception as e:
        logger.exception("Screenshot failed: %s", e)
        return 500, {
            "success": False,
            "error": str(e),
            "path": None,
            "url": None,
        }

    # URL the frontend can use to display the image (same origin as API)
    url = f"/api/screenshots/{filename}"
    logger.info("Screenshot saved: %s", filepath)
    return 200, {
        "success": True,
        "path": str(filepath),
        "filename": filename,
        "url": url,
        "message": "Screenshot saved. You can show the user the image at the URL above.",
    }
