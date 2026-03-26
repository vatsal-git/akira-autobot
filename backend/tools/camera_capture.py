"""
Capture a photo from the default or selected webcam on the machine running the Akira API.
Requires camera permission at the OS level; runs only where the Python process runs.
"""
import base64
import io
import logging
import sys
from typing import Any, Dict, Optional, Tuple

from backend.core.llm_limits import MAX_SINGLE_STRING_IN_TOOL

logger = logging.getLogger(__name__)

try:
    import cv2
except ImportError:
    cv2 = None

_MAX_PHOTO_B64_CHARS = MAX_SINGLE_STRING_IN_TOOL

TOOL_DEF = {
    "name": "camera_capture",
    "description": (
        "Takes a single photo from a webcam on the PC running the Akira server. "
        "Use when the user wants a picture of themselves or the room in front of the camera. "
        "Returns a JPEG as base64 in the result (same limits as other vision payloads). "
        "The user must grant camera access in Windows settings if the capture fails. "
        "If multiple cameras exist, try camera_index 0 first, then 1. "
        "Enable only when you trust camera use on this machine."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "camera_index": {
                "type": "integer",
                "description": "Webcam index (usually 0 for the default camera).",
                "default": 0,
            },
            "warmup_frames": {
                "type": "integer",
                "description": "Number of frames to discard before capture (helps some drivers stabilize). Default 5, max 30.",
                "default": 5,
            },
        },
        "required": [],
    },
    "default_enabled": False,
    "timeout_seconds": 60,
}


def _ensure_cv2() -> Optional[str]:
    if cv2 is None:
        return (
            "OpenCV is not installed. Install with: pip install opencv-python "
            "(on the machine where the Akira server runs)."
        )
    return None


def _frame_to_jpeg_b64(frame_bgr: Any) -> Tuple[int, Dict[str, Any]]:
    """BGR OpenCV frame → JPEG base64, downscaled to fit context limits."""
    try:
        from PIL import Image
    except ImportError:
        return 500, {
            "error": "Pillow is required. Install with: pip install Pillow",
        }

    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(rgb)

    max_dim = 1024
    quality = 68
    while max_dim >= 280:
        im = img
        w, h = im.size
        if max(w, h) > max_dim:
            ratio = max_dim / float(max(w, h))
            im = im.resize(
                (max(1, int(w * ratio)), max(1, int(h * ratio))),
                Image.Resampling.LANCZOS,
            )
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True)
        b64 = base64.standard_b64encode(buf.getvalue()).decode("ascii")
        if len(b64) <= _MAX_PHOTO_B64_CHARS:
            return 200, {
                "format": "jpeg",
                "base64": b64,
                "width": im.size[0],
                "height": im.size[1],
            }
        max_dim = int(max_dim * 0.75)
        quality = max(40, quality - 10)

    return 500, {
        "error": "Could not compress the photo enough for context limits.",
    }


def call_tool(tool_input: dict, context=None):
    err = _ensure_cv2()
    if err:
        return 500, {"error": err}

    assert cv2 is not None

    cam_idx = tool_input.get("camera_index")
    if cam_idx is None:
        cam_idx = 0
    try:
        cam_idx = int(cam_idx)
    except (TypeError, ValueError):
        return 400, {"error": "camera_index must be an integer."}
    if cam_idx < 0 or cam_idx > 16:
        return 400, {"error": "camera_index must be between 0 and 16."}

    warmup = tool_input.get("warmup_frames", 5)
    try:
        warmup = int(warmup)
    except (TypeError, ValueError):
        return 400, {"error": "warmup_frames must be an integer."}
    warmup = max(0, min(30, warmup))

    cap = None
    try:
        # CAP_DSHOW avoids some hangs on Windows when opening the default camera.
        if sys.platform == "win32" and hasattr(cv2, "CAP_DSHOW"):
            cap = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)
        else:
            cap = cv2.VideoCapture(cam_idx)

        if not cap.isOpened():
            return 500, {
                "error": (
                    f"Could not open camera index {cam_idx}. "
                    "Check that a webcam is connected, not in use by another app, "
                    "and that Windows privacy settings allow camera access for desktop apps."
                ),
                "camera_index": cam_idx,
            }

        frame = None
        for _ in range(warmup + 1):
            ok, fr = cap.read()
            if ok and fr is not None:
                frame = fr

        if frame is None:
            return 500, {
                "error": "Could not read any frame from the camera.",
                "camera_index": cam_idx,
            }

        status, payload = _frame_to_jpeg_b64(frame)
        if status != 200:
            return status, payload
        payload["camera_index"] = cam_idx
        return 200, payload
    except Exception as e:
        logger.exception("camera_capture failed")
        return 500, {"error": str(e), "camera_index": cam_idx}
    finally:
        if cap is not None:
            cap.release()
