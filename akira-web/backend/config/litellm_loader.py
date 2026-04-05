"""Load and resolve backend/config/litellm_config.yaml for LiteLLM Router."""

from __future__ import annotations

import logging
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests
import yaml

_ENV_PATTERN = re.compile(r"\$\{([^}]+)\}")
_logger = logging.getLogger(__name__)

# Hardcoded fallback if API fetch fails
OPENROUTER_FREE_FALLBACK = [
    "qwen/qwen3.6-plus-preview:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "minimax/minimax-m2.5:free",
    "stepfun/step-3.5-flash:free",
    "arcee-ai/trinity-large-preview:free",
    "liquid/lfm-2.5-1.2b-instruct:free",
]


def fetch_free_openrouter_models(api_key: str, timeout: float = 10.0) -> List[str]:
    """
    Fetch available free models from OpenRouter API.
    Returns list of model IDs with ':free' suffix, or fallback list on error.
    """
    if not api_key or not api_key.strip():
        _logger.warning("No OPENROUTER_API_KEY, using fallback free models")
        return OPENROUTER_FREE_FALLBACK.copy()

    try:
        response = requests.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {api_key.strip()}"},
            timeout=timeout,
        )
        response.raise_for_status()
        models = response.json().get("data", [])
        free_models = [m["id"] for m in models if ":free" in m.get("id", "")]

        if free_models:
            _logger.info("Fetched %d free models from OpenRouter", len(free_models))
            return free_models
        else:
            _logger.warning("No free models found, using fallback")
            return OPENROUTER_FREE_FALLBACK.copy()

    except Exception as e:
        _logger.warning("Failed to fetch OpenRouter models: %s, using fallback", e)
        return OPENROUTER_FREE_FALLBACK.copy()


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


def _build_dynamic_free_models(api_key: str) -> Tuple[List[Dict[str, Any]], Dict[str, List[str]]]:
    """
    Fetch free models and build model_list + fallbacks dict for LiteLLM Router.
    Returns (model_list, fallbacks_dict).
    """
    free_model_ids = fetch_free_openrouter_models(api_key)

    model_list = []
    aliases = []
    for i, model_id in enumerate(free_model_ids):
        alias = f"openrouter-free-{i}"
        aliases.append(alias)
        model_list.append({
            "model_name": alias,
            "litellm_params": {
                "model": f"openrouter/{model_id}",
                "api_key": api_key,
            },
        })

    # Build fallbacks: each model falls back to all subsequent models
    fallbacks = {}
    if len(aliases) > 1:
        fallbacks[aliases[0]] = aliases[1:]

    return model_list, fallbacks


def load_litellm_config() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Returns (model_list, settings) with env substitution and invalid models removed.
    If use_dynamic_free_models is enabled, fetches free models from OpenRouter API.
    """
    path = Path(__file__).resolve().parent / "litellm_config.yaml"
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    data = _substitute_env(deepcopy(raw))
    settings = dict(data.get("settings") or {})

    # Check if dynamic free models are enabled
    use_dynamic = settings.pop("use_dynamic_free_models", False)
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()

    if use_dynamic and api_key:
        model_list, fallbacks = _build_dynamic_free_models(api_key)
        settings["fallbacks"] = fallbacks
        settings["default_model"] = "openrouter-free-0" if model_list else None
        _logger.info("Using dynamic free models: %d loaded", len(model_list))
    else:
        # Use static model_list from YAML
        model_list = data.get("model_list") or []
        model_list = _drop_invalid_models(model_list)

    valid_names = {e.get("model_name") for e in model_list if e.get("model_name")}

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
