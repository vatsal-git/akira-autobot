"""
In-memory store for full get_ui_elements / screen parse element payloads.
Used for two-step parse: compact list to the LLM, full bbox/center on resolve.
"""
from __future__ import annotations

import threading
import time
import uuid
from collections import OrderedDict
from typing import Any, Dict, Optional, Tuple

DEFAULT_TTL_SECONDS = 900.0  # 15 minutes
DEFAULT_MAX_SESSIONS = 50


class ScreenParseSessionStore:
    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        max_sessions: int = DEFAULT_MAX_SESSIONS,
    ) -> None:
        self._ttl = ttl_seconds
        self._max = max_sessions
        self._lock = threading.Lock()
        # FIFO insert order; session_id -> (expires_at_monotonic, payload)
        self._data: OrderedDict[str, Tuple[float, Dict[str, Any]]] = OrderedDict()

    def _purge_expired_unlocked(self, now: float) -> None:
        dead = [k for k, (exp, _) in self._data.items() if exp <= now]
        for k in dead:
            del self._data[k]

    def _evict_fifo_unlocked(self) -> None:
        while len(self._data) >= self._max:
            if not self._data:
                return
            self._data.popitem(last=False)

    def put(self, payload: Dict[str, Any]) -> str:
        """Store payload; returns new opaque session id."""
        sid = str(uuid.uuid4())
        now = time.monotonic()
        expires = now + self._ttl
        with self._lock:
            self._purge_expired_unlocked(now)
            self._evict_fifo_unlocked()
            self._data[sid] = (expires, dict(payload))
        return sid

    def get(self, session_id: str) -> Optional[Dict[str, Any]]:
        if not session_id or not isinstance(session_id, str):
            return None
        now = time.monotonic()
        with self._lock:
            self._purge_expired_unlocked(now)
            row = self._data.get(session_id)
            if row is None:
                return None
            exp, payload = row
            if exp <= now:
                del self._data[session_id]
                return None
            self._data.move_to_end(session_id)
            return dict(payload)

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._data.pop(session_id, None)


# Process-wide singleton for desktop_ui_parse / get_ui_elements
store = ScreenParseSessionStore()
