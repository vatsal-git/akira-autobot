#!/usr/bin/env python3
"""
Fetch OpenRouter models and rank them best-to-worst.
API: openapi.yaml — servers[0].url + GET /models, response = ModelsListResponse (data: Model[]).
Uses a composite score: context length, max completion tokens, supported params, and cost.
Top 10 are printed. Requires OPENROUTER_API_KEY in .env or environment.
"""

import os
import sys
import math
import requests

# Load .env from backend root when run from repo root or backend/scripts
_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
try:
    import dotenv
    dotenv.load_dotenv(os.path.join(_backend, ".env"))
except Exception:
    pass

# openapi.yaml: servers[0].url = https://openrouter.ai/api/v1, path = /models
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


def fetch_models(token: str) -> list[dict]:
    """Fetch all models from OpenRouter API."""
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(OPENROUTER_MODELS_URL, headers=headers, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data.get("data") or []


def safe_float(s, default: float = 0.0) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def cost_per_million_tokens(model: dict) -> float:
    """Prompt + completion cost per 1M tokens (lower = better value)."""
    pricing = model.get("pricing") or {}
    prompt = safe_float(pricing.get("prompt"), 0.0)
    completion = safe_float(pricing.get("completion"), 0.0)
    # Per-token cost is in USD; 1M tokens = multiply by 1_000_000
    return (prompt + completion) * 1_000_000


def score_model(model: dict) -> tuple[float, dict]:
    """
    Compute a single 'best' score (higher = better).
    Returns (score, debug_info).
    """
    # 1) Context length (log scale, cap at 1M) — major factor
    ctx = model.get("context_length") or 0
    ctx_score = math.log10(max(ctx, 256) + 1) / math.log10(1_000_000 + 1)

    # 2) Max completion tokens from top_provider
    top = model.get("top_provider") or {}
    max_comp = top.get("max_completion_tokens") or 4096
    comp_score = math.log10(max(max_comp, 256) + 1) / math.log10(65536 + 1)

    # 3) Supported parameters (more = more flexible)
    params = model.get("supported_parameters") or []
    param_score = min(len(params) / 10.0, 1.0)

    # 4) Cost: prefer lower cost (better value). Free = high value score.
    cost = cost_per_million_tokens(model)
    if cost <= 0:
        cost_score = 1.0
    else:
        # Inverse scale: $0.01/1M -> 0.5, $0.001/1M -> 1.0, $1/1M -> ~0
        cost_score = max(0, 1.0 - math.log10(cost + 0.0001) / 4.0)

    # 5) Modality: text->text is standard; no penalty for others
    arch = model.get("architecture") or {}
    modality = (arch.get("modality") or "").lower()
    modality_ok = "text" in modality or not modality
    modality_score = 1.0 if modality_ok else 0.5

    # Weights: capability (context + completion) > value (cost) > flexibility (params)
    score = (
        ctx_score * 0.35
        + comp_score * 0.25
        + cost_score * 0.25
        + param_score * 0.10
        + modality_score * 0.05
    )

    debug = {
        "context_length": ctx,
        "max_completion_tokens": max_comp,
        "supported_params": len(params),
        "cost_per_million_usd": round(cost, 4),
        "modality": modality or "unknown",
    }
    return score, debug


def _expired(exp) -> bool:
    """True if expiration_date is set and in the past."""
    if exp is None:
        return False
    import time
    now = int(time.time())
    if isinstance(exp, (int, float)):
        return exp < now
    if isinstance(exp, str):
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            return dt.timestamp() < now
        except Exception:
            return False
    return False


def filter_valid(models: list[dict]) -> list[dict]:
    """Drop models that are expired or missing required fields."""
    out = []
    for m in models:
        if _expired(m.get("expiration_date")):
            continue
        if not m.get("id"):
            continue
        out.append(m)
    return out


def main() -> None:
    token = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not token:
        print("Set OPENROUTER_API_KEY in .env or environment.", file=sys.stderr)
        sys.exit(1)

    print("Fetching OpenRouter models...")
    models = fetch_models(token)
    print(f"Fetched {len(models)} models.")

    models = filter_valid(models)
    scored = []
    for m in models:
        s, debug = score_model(m)
        scored.append((s, debug, m))

    scored.sort(key=lambda x: -x[0])
    top10 = scored[:10]

    print("\n--- Top 10 OpenRouter models (best to worst) ---\n")
    for i, (score, debug, m) in enumerate(top10, 1):
        name = m.get("name") or m.get("id") or "?"
        mid = m.get("id") or "?"
        ctx = debug["context_length"]
        cost = debug["cost_per_million_usd"]
        print(f"{i:2}. {name}")
        print(f"    id: {mid}")
        print(f"    context: {ctx:,}  max_completion: {debug['max_completion_tokens']:,}  cost/1M tokens: ${cost}")
        print(f"    score: {score:.3f}")
        print()

    # Optional: write full sorted list to JSON
    out_path = os.path.join(_backend, "scripts", "openrouter_models_ranked.json")
    try:
        import json
        payload = [
            {
                "rank": i,
                "score": s,
                "id": m.get("id"),
                "name": m.get("name"),
                "context_length": m.get("context_length"),
                "max_completion_tokens": (m.get("top_provider") or {}).get("max_completion_tokens"),
                "cost_per_million_usd": cost_per_million_tokens(m),
            }
            for i, (s, _, m) in enumerate(scored[:50], 1)
        ]
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print(f"Top 50 written to {out_path}")
    except Exception as e:
        print(f"Could not write JSON: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
