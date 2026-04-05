"""
screenshot_parse backends: EasyOCR (default, no Hugging Face Hub) or OmniParser v2, or auto (Omni first, then EasyOCR).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

logger = logging.getLogger(__name__)


def parse_with_omniparser(
    image: Image.Image,
    *,
    bbox_threshold: float = 0.05,
    iou_threshold: float = 0.7,
    max_elements: int = 80,
    max_label_len: int = 160,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    from backend.core.omniparser_screen import get_parser

    parser, err = get_parser()
    if err or parser is None:
        return None, err
    try:
        raw = parser.parse(
            image,
            bbox_threshold=bbox_threshold,
            iou_threshold=iou_threshold,
        )
    except Exception as e:
        logger.exception("OmniParser parse failed")
        return None, str(e)

    w, h = image.size
    out: List[Dict[str, Any]] = []
    for i, item in enumerate(raw[:max_elements]):
        bbox = item["bbox"]
        left = int(max(0, min(w - 1, bbox[0] * w)))
        top = int(max(0, min(h - 1, bbox[1] * h)))
        right = int(max(0, min(w, bbox[2] * w)))
        bottom = int(max(0, min(h, bbox[3] * h)))
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        label = item.get("content") or ""
        if len(label) > max_label_len:
            label = label[: max_label_len - 3] + "..."
        out.append(
            {
                "id": i,
                "type": item.get("type", "unknown"),
                "label": label,
                "interactivity": bool(item.get("interactivity", False)),
                "bbox": {
                    "left": left,
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                    "width": max(0, right - left),
                    "height": max(0, bottom - top),
                },
                "center": {"x": cx, "y": cy},
            }
        )
    return out, None


def run_screenshot_parse(
    image: Image.Image,
    *,
    parse_backend: str = "easyocr",
    bbox_threshold: float = 0.05,
    iou_threshold: float = 0.7,
    max_elements: int = 80,
    max_label_len: int = 160,
) -> Tuple[Optional[List[Dict[str, Any]]], str, Optional[str]]:
    """
    Returns (elements, parser_id, error).
    parser_id: omniparser_v2 | easyocr_text
    """
    mode = (parse_backend or "easyocr").strip().lower()
    if mode not in ("auto", "omniparser", "easyocr"):
        mode = "easyocr"

    from backend.core.screen_parse_easyocr import parse_screenshot_easyocr

    if mode == "easyocr":
        el, err = parse_screenshot_easyocr(
            image,
            max_elements=max_elements,
            max_label_len=max_label_len,
        )
        return el, "easyocr_text", err

    if mode == "omniparser":
        el, err = parse_with_omniparser(
            image,
            bbox_threshold=bbox_threshold,
            iou_threshold=iou_threshold,
            max_elements=max_elements,
            max_label_len=max_label_len,
        )
        return el, "omniparser_v2", err

    # auto: OmniParser only when local weights exist (no implicit Hugging Face download)
    skip = os.environ.get("AKIRA_SKIP_OMNIPARSER", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    omni_dir = os.environ.get("AKIRA_OMNIPARSER_DIR", "").strip()
    if not skip and omni_dir and os.path.isdir(omni_dir):
        icon_pt = os.path.join(omni_dir, "icon_detect", "model.pt")
        cap_dir = os.path.join(omni_dir, "icon_caption")
        if os.path.isfile(icon_pt) and os.path.isdir(cap_dir):
            el, err = parse_with_omniparser(
                image,
                bbox_threshold=bbox_threshold,
                iou_threshold=iou_threshold,
                max_elements=max_elements,
                max_label_len=max_label_len,
            )
            if not err and el is not None:
                return el, "omniparser_v2", None
            logger.warning(
                "OmniParser failed with AKIRA_OMNIPARSER_DIR; falling back to EasyOCR: %s",
                err,
            )
        else:
            logger.info(
                "auto: AKIRA_OMNIPARSER_DIR missing icon_detect/model.pt or icon_caption/; using EasyOCR"
            )
    elif not skip and not omni_dir:
        logger.debug(
            "auto: no AKIRA_OMNIPARSER_DIR — using EasyOCR (set AKIRA_OMNIPARSER_DIR for local OmniParser weights)"
        )

    el, err = parse_screenshot_easyocr(
        image,
        max_elements=max_elements,
        max_label_len=max_label_len,
    )
    return el, "easyocr_text", err
