"""
Text-only regions from screenshots using EasyOCR (models load from EasyOCR/JaidedAI CDNs, not Hugging Face Hub).

pip install easyocr
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        import torch

        _reader = easyocr.Reader(
            ["en"],
            gpu=torch.cuda.is_available(),
            verbose=False,
        )
    return _reader


def parse_screenshot_easyocr(
    image: Image.Image,
    *,
    max_elements: int = 80,
    max_label_len: int = 160,
    min_confidence: float = 0.25,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    try:
        reader = _get_reader()
    except ImportError as e:
        return None, (
            "EasyOCR is not installed. Run: pip install easyocr "
            f"({e})"
        )
    except Exception as e:
        logger.exception("EasyOCR reader init failed")
        return None, str(e)

    img = image.convert("RGB")
    w, h = img.size
    arr = np.asarray(img)

    try:
        raw = reader.readtext(arr, paragraph=False)
    except Exception as e:
        logger.exception("EasyOCR readtext failed")
        return None, str(e)

    scored = [(box, text, float(conf)) for box, text, conf in raw if float(conf) >= min_confidence]
    scored.sort(key=lambda x: -x[2])

    out: List[Dict[str, Any]] = []
    for i, (box, text, conf) in enumerate(scored[:max_elements]):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        left = int(max(0, min(w - 1, min(xs))))
        top = int(max(0, min(h - 1, min(ys))))
        right = int(max(0, min(w, max(xs))))
        bottom = int(max(0, min(h, max(ys))))
        if right <= left or bottom <= top:
            continue
        label = (text or "").strip()
        if len(label) > max_label_len:
            label = label[: max_label_len - 3] + "..."
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        out.append(
            {
                "id": len(out),
                "type": "text",
                "label": label,
                "interactivity": len(label) <= 40,
                "confidence": round(conf, 4),
                "bbox": {
                    "left": left,
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                    "width": right - left,
                    "height": bottom - top,
                },
                "center": {"x": cx, "y": cy},
            }
        )

    return out, None
