"""Request guardrails: API-key auth, rate limiting, and answer citation checks."""

from __future__ import annotations

import hmac
import math
import re
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

from .config import Settings

API_KEY_HEADER = "X-API-Key"


# ------------------------------------------------------------------- auth


def _key_ok(settings: Settings, request: Request) -> bool:
    supplied = request.headers.get(API_KEY_HEADER, "")
    return hmac.compare_digest(supplied.encode(), (settings.api_key or "").encode())


def auth_dependencies(settings: Settings) -> tuple[Callable[[Request], None], Callable[[Request], None]]:
    """Return (require_write, require_read) FastAPI dependencies."""

    def require_write(request: Request) -> None:
        if settings.api_key and not _key_ok(settings, request):
            raise HTTPException(
                401,
                "This backend requires an API key for changes. Add it in Settings.",
                headers={"WWW-Authenticate": "ApiKey"},
            )

    def require_read(request: Request) -> None:
        if settings.api_key and settings.protect_reads and not _key_ok(settings, request):
            raise HTTPException(
                401,
                "This backend requires an API key. Add it in Settings.",
                headers={"WWW-Authenticate": "ApiKey"},
            )

    return require_write, require_read


# ------------------------------------------------------------ rate limits


class RateLimiter:
    """In-memory sliding-window limiter. Per process — fine for the single
    worker this app runs with; use a shared store if you scale out."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._clock = clock

    def hit(self, key: str, limit: int, window: float) -> float | None:
        """Record a request. Returns seconds to wait if over the limit, else None."""
        if limit <= 0:
            return None
        now = self._clock()
        with self._lock:
            q = self._events.setdefault(key, deque())
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return max(q[0] + window - now, 0.0)
            q.append(now)
            if len(self._events) > 10_000:  # drop idle clients so memory stays bounded
                for k in [k for k, v in self._events.items() if not v or v[-1] <= now - 3600]:
                    del self._events[k]
            return None


def client_id(request: Request) -> str:
    # Behind a proxy run uvicorn with --proxy-headers so this is the real client.
    return request.client.host if request.client else "unknown"


def rate_limit(limiter: RateLimiter, bucket: str, rules: Callable[[], list[tuple[str, int, float]]]):
    """Dependency enforcing every (scope, limit, window) rule; scope is
    "client" (per IP) or "global" (all clients together)."""

    def dependency(request: Request) -> None:
        for scope, limit, window in rules():
            key = f"{bucket}:{scope}:{client_id(request) if scope == 'client' else '*'}"
            wait = limiter.hit(key, limit, window)
            if wait is not None:
                retry = max(1, math.ceil(wait))
                who = "for everyone" if scope == "global" else "from this client"
                raise HTTPException(
                    429,
                    f"Too many {bucket} requests {who}. Try again in {retry} s.",
                    headers={"Retry-After": str(retry)},
                )

    return dependency


# --------------------------------------------------------- citation check

_CITE = re.compile(r"\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]")


def check_citations(answer: str, source_count: int) -> dict[str, object]:
    """Verify an answer's [n] citations against the sources it was given."""
    cited: set[int] = set()
    for group in _CITE.findall(answer):
        cited.update(int(n) for n in re.split(r"\s*,\s*", group))
    return {
        "cited": sorted(n for n in cited if 1 <= n <= source_count),
        "invalid": sorted(n for n in cited if not 1 <= n <= source_count),
        "uncited": bool(answer.strip()) and not cited,
        "source_count": source_count,
    }
