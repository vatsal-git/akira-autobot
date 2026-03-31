"""Load and resolve backend/config/litellm_config.yaml for LiteLLM Router."""

from __future__ import annotations

import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

_ENV_PATTERN = re.compile(r"\$\{([^}]+)\}")


def _substitute_env(obj: Any) -> Any:
    if isinstance(obj, str):

        def repl(m: re.Match) -> str:
            key = m.group(1).strip()
            return os.getenv(key, "")

        return _ENV_PATTERN.sub(repl, obj)
    if isinstance(obj, dict):
        return {k: _substitute_env(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute_env(x) for x in obj]
    return obj


def _drop_invalid_models(model_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove entries whose resolved model string is unusable (e.g. empty Bedrock profile)."""
    out: List[Dict[str, Any]] = []
    for entry in model_list:
        params = entry.get("litellm_params") or {}
        m = (params.get("model") or "").strip()
        if m.startswith("bedrock/") and len(m) <= len("bedrock/"):
            continue
        if m.startswith("bedrock/") and m.split("/", 1)[1].strip() == "":
            continue
        out.append(entry)
    return out


def _filter_fallback_order(
    order: List[str], valid_names: set[str]
) -> List[str]:
    return [a for a in order if a in valid_names]


def load_litellm_config() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Returns (model_list, settings) with env substitution and invalid models removed.
    """
    path = Path(__file__).resolve().parent / "litellm_config.yaml"
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    data = _substitute_env(deepcopy(raw))
    model_list = data.get("model_list") or []
    model_list = _drop_invalid_models(model_list)
    valid_names = {e.get("model_name") for e in model_list if e.get("model_name")}
    settings = dict(data.get("settings") or {})
    fo = settings.get("fallback_order") or []
    if isinstance(fo, list):
        settings["fallback_order"] = _filter_fallback_order(fo, valid_names)
    else:
        settings["fallback_order"] = list(valid_names)
    dm = settings.get("default_model")
    if dm and dm not in valid_names:
        first = next(iter(valid_names), None)
        if first:
            settings["default_model"] = first
        elif dm:
            settings["default_model"] = dm
    return model_list, settings


def list_model_aliases() -> List[str]:
    ml, _ = load_litellm_config()
    return [e["model_name"] for e in ml if e.get("model_name")]
