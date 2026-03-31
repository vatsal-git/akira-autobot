"""Screen bitmap UI parsing (OCR / OmniParser). Runs on the Akira server host."""
from backend.tools.desktop_control._desktop_control_core import call_desktop_tool

TOOL_DEF = {
    "name": "desktop_ui_parse",
    "description": (
        "Vision on the screen bitmap when windows_uia is weak (many web UIs). Two-step workflow: "
        "(1) get_ui_elements captures the screen, runs OCR/OmniParser, stores results, and returns "
        "parse_session_id plus newline-separated labels_text and element_ids (same order—use those ids in step 2). "
        "(2) get_ui_element_coords with parse_session_id and element_ids returns full element JSON (bbox, center, etc.) "
        "for only the targets you need—fetch coords before clicking with desktop_mouse. "
        "Optional region crops capture. Default parse_backend is easyocr (pip install easyocr; models use EasyOCR CDNs). "
        "For full OmniParser v2, clone OmniParser (or set AKIRA_OMNIPARSER_REPO), install backend/requirements-omniparser.txt, "
        "set AKIRA_OMNIPARSER_DIR and local Florence-2-base (AKIRA_FLORENCE_BASE_DIR); parse_backend omniparser or auto. "
        "Enable only when you trust this environment."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["get_ui_elements", "get_ui_element_coords"],
                "description": "get_ui_elements first; then get_ui_element_coords for chosen ids.",
            },
            "region": {
                "type": "object",
                "properties": {
                    "left": {"type": "number"},
                    "top": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                },
                "description": "Optional rectangle for get_ui_elements; omit for full screen.",
            },
            "max_elements": {
                "type": "integer",
                "description": "get_ui_elements: max elements (default 80, max 200).",
            },
            "bbox_threshold": {
                "type": "number",
                "description": "get_ui_elements: detector confidence (default 0.05).",
            },
            "iou_threshold": {
                "type": "number",
                "description": "get_ui_elements: overlap merge IOU for omniparser (default 0.7).",
            },
            "parse_backend": {
                "type": "string",
                "enum": ["easyocr", "omniparser", "auto"],
                "description": (
                    "get_ui_elements: easyocr = text regions (default). "
                    "omniparser = OmniParser v2 from cloned repo + local weights. "
                    "auto = OmniParser if weights present, else EasyOCR."
                ),
            },
            "parse_session_id": {
                "type": "string",
                "description": "get_ui_element_coords: id from get_ui_elements.",
            },
            "element_ids": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "get_ui_element_coords: ids to resolve (max 64), from get_ui_elements.element_ids.",
            },
        },
        "required": ["action"],
    },
    "default_enabled": False,
    "timeout_seconds": 300,
}


def call_tool(tool_input: dict, context=None):
    return call_desktop_tool("ui_parse", tool_input, context)
