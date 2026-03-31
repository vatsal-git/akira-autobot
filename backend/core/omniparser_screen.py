"""
OmniParser screen parsing via the cloned Microsoft OmniParser repo (util/utils.py pipeline).

Code: set AKIRA_OMNIPARSER_REPO to the repo root (folder containing util/). Default: <Akira project>/OmniParser.
If the clone lives next to this repo (e.g. Projects/OmniParser vs Projects/Akira), set AKIRA_OMNIPARSER_REPO.

Weights: required local folder AKIRA_OMNIPARSER_DIR with OmniParser v2 layout
(icon_detect/model.pt, icon_caption/). No Hugging Face downloads from Akira.

Florence processor (microsoft/Florence-2-base) must also be on disk: set AKIRA_FLORENCE_BASE_DIR to that
folder snapshot, or put it at AKIRA_OMNIPARSER_DIR/Florence-2-base/. All loads use local_files_only=True
(suitable for locked-down / office machines). Optionally set TRANSFORMERS_OFFLINE=1.

EasyOCR (inside OmniParser util) may still download English models from its own CDN on first run unless
you pre-seed ~/.EasyOCR or configure EasyOCR offline separately.

Upstream util/utils.py imports PaddleOCR at module load (even with use_paddleocr=False); install
backend/requirements-omniparser.txt including paddle lines.

Licensing: see https://github.com/microsoft/OmniParser and the Hugging Face model card.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

logger = logging.getLogger(__name__)

_parser_singleton: Optional["ClonedOmniParserRunner"] = None


def _default_omniparser_repo() -> Path:
    """backend/core/omniparser_screen.py -> project root -> OmniParser."""
    return Path(__file__).resolve().parent.parent.parent / "OmniParser"


def omniparser_repo_root() -> Optional[str]:
    env = os.environ.get("AKIRA_OMNIPARSER_REPO", "").strip()
    if env and os.path.isdir(env):
        return os.path.abspath(env)
    cand = _default_omniparser_repo()
    if cand.is_dir() and (cand / "util" / "utils.py").is_file():
        return str(cand)
    return None


def _ensure_repo_on_path(repo: str) -> None:
    if repo and repo not in sys.path:
        sys.path.insert(0, repo)


def omniparser_dependency_error() -> Optional[str]:
    try:
        import cv2  # noqa: F401
        import easyocr  # noqa: F401
        import torch  # noqa: F401
        import ultralytics  # noqa: F401
        from torchvision.ops import box_convert  # noqa: F401
        from torchvision.transforms import ToPILImage  # noqa: F401
        from transformers import AutoModelForCausalLM, AutoProcessor  # noqa: F401
    except ImportError as e:
        return (
            "OmniParser dependencies missing. Install: pip install -r backend/requirements-omniparser.txt "
            f"({e})"
        )
    try:
        import supervision  # noqa: F401
    except ImportError as e:
        return f"OmniParser needs supervision: pip install supervision>=0.18.0 ({e})"
    repo = omniparser_repo_root()
    if not repo:
        return (
            "OmniParser code repo not found. Clone https://github.com/microsoft/OmniParser into "
            f"{_default_omniparser_repo()} or set AKIRA_OMNIPARSER_REPO to the repo root (folder with util/)."
        )
    try:
        _ensure_repo_on_path(repo)
        import util.utils  # noqa: F401
    except ImportError as e:
        return (
            f"Failed to import OmniParser util (repo={repo!r}). "
            f"Install full optional deps: pip install -r backend/requirements-omniparser.txt ({e})"
        )
    return None


def resolve_florence_base_dir(model_dir: str) -> Optional[str]:
    """
    Local snapshot of microsoft/Florence-2-base (processor). Required for offline use — no Hub access.
    """
    explicit = os.environ.get("AKIRA_FLORENCE_BASE_DIR", "").strip()
    if explicit and os.path.isdir(explicit):
        return os.path.abspath(explicit)
    nested = os.path.join(model_dir, "Florence-2-base")
    if os.path.isdir(nested):
        return nested
    return None


def _load_florence_caption_bundle(model_dir: str, device: str) -> Dict[str, Any]:
    """Same dict shape as OmniParser get_caption_model_processor; loads only from local paths."""
    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    florence_dir = resolve_florence_base_dir(model_dir)
    if not florence_dir:
        raise ValueError(
            "Office/offline: place a full snapshot of microsoft/Florence-2-base on disk and set "
            "AKIRA_FLORENCE_BASE_DIR to that folder, or copy it to "
            f"{os.path.join(model_dir, 'Florence-2-base')}. "
            "Copy from another machine that can access Hugging Face (huggingface-cli download), "
            "then transfer the folder. Akira never calls the Hub for these loads."
        )
    cap_path = os.path.join(model_dir, "icon_caption")
    processor = AutoProcessor.from_pretrained(
        florence_dir,
        local_files_only=True,
        trust_remote_code=True,
    )
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        cap_path,
        torch_dtype=dtype,
        trust_remote_code=True,
        local_files_only=True,
    ).to(device)
    return {"model": model, "processor": processor}


class ClonedOmniParserRunner:
    """Loads YOLO + Florence caption weights once; runs official get_som_labeled_img."""

    def __init__(self, model_dir: str) -> None:
        import torch

        repo = omniparser_repo_root()
        assert repo is not None
        _ensure_repo_on_path(repo)
        from util.utils import get_yolo_model

        device = "cuda" if torch.cuda.is_available() else "cpu"

        som_path = os.path.join(model_dir, "icon_detect", "model.pt")
        self.som_model = get_yolo_model(som_path)
        self.caption_model_processor = _load_florence_caption_bundle(model_dir, device)

    def parse(
        self,
        image: Image.Image,
        *,
        bbox_threshold: float = 0.05,
        iou_threshold: float = 0.7,
        caption_batch_size: int = 128,
    ) -> List[Dict[str, Any]]:
        repo = omniparser_repo_root()
        assert repo is not None
        _ensure_repo_on_path(repo)
        from util.utils import check_ocr_box, get_som_labeled_img

        if image.mode != "RGB":
            image = image.convert("RGB")

        box_overlay_ratio = max(image.size) / 3200
        draw_bbox_config = {
            "text_scale": 0.8 * box_overlay_ratio,
            "text_thickness": max(int(2 * box_overlay_ratio), 1),
            "text_padding": max(int(3 * box_overlay_ratio), 1),
            "thickness": max(int(3 * box_overlay_ratio), 1),
        }

        (text, ocr_bbox), _ = check_ocr_box(
            image,
            display_img=False,
            output_bb_format="xyxy",
            easyocr_args={"text_threshold": 0.8},
            use_paddleocr=False,
        )
        _encoded, _label_coordinates, filtered_boxes_elem = get_som_labeled_img(
            image,
            self.som_model,
            BOX_TRESHOLD=bbox_threshold,
            output_coord_in_ratio=True,
            ocr_bbox=ocr_bbox,
            draw_bbox_config=draw_bbox_config,
            caption_model_processor=self.caption_model_processor,
            ocr_text=text,
            use_local_semantics=True,
            iou_threshold=iou_threshold,
            scale_img=False,
            batch_size=caption_batch_size,
        )
        return filtered_boxes_elem


def _missing_weights_dir_message() -> str:
    return (
        "Set AKIRA_OMNIPARSER_DIR to a local folder with OmniParser v2 weights "
        "(icon_detect/model.pt and icon_caption/). Also provide Florence-2-base on disk "
        "(AKIRA_FLORENCE_BASE_DIR or AKIRA_OMNIPARSER_DIR/Florence-2-base). "
        "Akira does not use Hugging Face from this machine."
    )


def _missing_florence_message(model_dir: str) -> str:
    return (
        "Office/offline: add a local copy of microsoft/Florence-2-base (full snapshot). "
        f"Set AKIRA_FLORENCE_BASE_DIR to that folder, or create {os.path.join(model_dir, 'Florence-2-base')}. "
        "Transfer from a machine that can run: huggingface-cli download microsoft/Florence-2-base --local-dir ./Florence-2-base"
    )


def get_parser() -> Tuple[Optional[ClonedOmniParserRunner], Optional[str]]:
    global _parser_singleton
    dep_err = omniparser_dependency_error()
    if dep_err:
        return None, dep_err

    if _parser_singleton is not None:
        return _parser_singleton, None

    try:
        model_dir = os.environ.get("AKIRA_OMNIPARSER_DIR", "").strip()
        if not model_dir:
            return None, _missing_weights_dir_message()
        if not os.path.isdir(model_dir):
            return None, f"AKIRA_OMNIPARSER_DIR is not a directory: {model_dir}"
        miss = [
            p
            for p in (
                os.path.join(model_dir, "icon_detect", "model.pt"),
                os.path.join(model_dir, "icon_caption"),
            )
            if not os.path.exists(p)
        ]
        if miss:
            return None, (
                f"AKIRA_OMNIPARSER_DIR is missing expected files under {model_dir!r}. "
                f"Need icon_detect/model.pt and icon_caption/ (OmniParser v2 weight layout). "
                f"Missing: {miss}"
            )
        if resolve_florence_base_dir(model_dir) is None:
            return None, _missing_florence_message(model_dir)
        _parser_singleton = ClonedOmniParserRunner(model_dir)
        return _parser_singleton, None
    except Exception as e:
        logger.exception("OmniParser init failed")
        return None, str(e)


def parse_screenshot_pil(
    image: Image.Image,
    *,
    bbox_threshold: float = 0.05,
    iou_threshold: float = 0.7,
    max_elements: int = 80,
    max_label_len: int = 160,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Deprecated alias: use backend.core.screen_parse.parse_with_omniparser."""
    from backend.core.screen_parse import parse_with_omniparser

    return parse_with_omniparser(
        image,
        bbox_threshold=bbox_threshold,
        iou_threshold=iou_threshold,
        max_elements=max_elements,
        max_label_len=max_label_len,
    )
