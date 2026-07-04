"""Sliding-window in-memory rate limiter.

Per-process: state resets on cold start. With 2 Cloud Run instances the
effective limit doubles (acceptable backstop - not a billing fence).
"""
import threading
import time
from collections import defaultdict, deque

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)


def within_budget(bucket: str, key: str, limit: int, window_s: float = 60.0) -> bool:
    """Return True if the call is within budget; False if the rate limit is exceeded.

    bucket   - logical namespace, e.g. "llm"
    key      - per-user discriminator, e.g. user_id
    limit    - max calls allowed in window_s; <=0 disables (always returns True)
    window_s - sliding window length in seconds (default 60.0)
    """
    if limit <= 0:
        return True
    full_key = f"{bucket}:{key}"
    now = time.monotonic()
    with _lock:
        dq = _hits[full_key]
        cutoff = now - window_s
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True
