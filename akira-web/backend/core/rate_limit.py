"""
Simple in-memory rate limiter for API endpoints.
"""
import time
from collections import defaultdict
from typing import Dict, Tuple

from fastapi import Request, HTTPException

# (count, window_start_ts)
_store: Dict[str, Tuple[int, float]] = defaultdict(lambda: (0, 0.0))

# 20 requests per minute per key
RATE_LIMIT_REQUESTS = 20
RATE_LIMIT_WINDOW_SEC = 60.0


def check_rate_limit(key: str) -> bool:
    """Returns True if request is allowed, False if rate limited."""
    now = time.monotonic()
    count, window_start = _store[key]
    if now - window_start >= RATE_LIMIT_WINDOW_SEC:
        _store[key] = (1, now)
        return True
    if count >= RATE_LIMIT_REQUESTS:
        return False
    _store[key] = (count + 1, window_start)
    return True


def rate_limit_dependency(request: Request) -> None:
    """FastAPI dependency: enforce rate limit by IP or X-User-ID; raise 429 if exceeded."""
    key = request.headers.get("X-User-ID") or (request.client.host if request.client else "unknown")
    if not check_rate_limit(key):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
