import io
from typing import Any, Optional, Tuple

from backend.core.llm_limits import MAX_SINGLE_STRING_IN_TOOL

# Must stay <= MAX_SINGLE_STRING_IN_TOOL to avoid truncation in tool payloads.
MAX_SCREENSHOT_B64_CHARS = MAX_SINGLE_STRING_IN_TOOL

# Sidecar vision payload cap for provider image limits.
VISION_JPEG_MAX_RAW = 3_000_000


def screenshot_to_b64(
    *,
    pyautogui_module: Any,
    image_module: Any,
    base64_module: Any,
    region: Optional[Tuple[int, int, int, int]],
) -> Tuple[int, dict]:
    """Capture desktop as JPEG base64 under model-safe string limits."""
    if region is not None:
        img = pyautogui_module.screenshot(region=region)
    else:
        img = pyautogui_module.screenshot()
    img = img.convert("RGB")

    max_dim = 1024
    quality = 68
    while max_dim >= 280:
        im = img
        w, h = im.size
        if max(w, h) > max_dim:
            ratio = max_dim / float(max(w, h))
            im = im.resize(
                (max(1, int(w * ratio)), max(1, int(h * ratio))),
                image_module.Resampling.LANCZOS,
            )
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True)
        b64 = base64_module.standard_b64encode(buf.getvalue()).decode("ascii")
        if len(b64) <= MAX_SCREENSHOT_B64_CHARS:
            return 200, {
                "format": "jpeg",
                "base64": b64,
                "width": im.size[0],
                "height": im.size[1],
                "screen_space_note": "width/height are this JPEG size; clicks use OS pixels from get_screen_size.",
            }
        max_dim = int(max_dim * 0.75)
        quality = max(40, quality - 10)

    return 500, {
        "error": "Could not shrink screenshot enough for context limits. Use a smaller region (left, top, width, height).",
    }


def vision_jpeg_bytes(
    *,
    pyautogui_module: Any,
    image_module: Any,
    region: Optional[Tuple[int, int, int, int]],
) -> Tuple[int, Any]:
    """Capture desktop as JPEG bytes sized for one-off vision API calls."""
    if region is not None:
        img = pyautogui_module.screenshot(region=region)
    else:
        img = pyautogui_module.screenshot()
    img = img.convert("RGB")

    max_side = 2048
    quality = 88
    while max_side >= 480:
        im = img
        w, h = im.size
        if max(w, h) > max_side:
            ratio = max_side / float(max(w, h))
            im = im.resize(
                (max(1, int(w * ratio)), max(1, int(h * ratio))),
                image_module.Resampling.LANCZOS,
            )
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True)
        raw = buf.getvalue()
        if len(raw) <= VISION_JPEG_MAX_RAW:
            return 200, (raw, im.size[0], im.size[1])
        max_side = int(max_side * 0.72)
        quality = max(50, quality - 12)

    return 500, {
        "error": "Could not compress screenshot enough for the vision API. Use a smaller region.",
    }
