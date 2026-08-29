from __future__ import annotations

import math
import threading
import time
from collections import deque


class RateLimitExceeded(Exception):
    def __init__(self, message: str = "查询过于频繁，请稍后再试", retry_after: int = 60):
        super().__init__(message)
        self.retry_after = retry_after


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, *, limit: int, window_seconds: float) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = self._hits.get(key)
            if timestamps is None:
                timestamps = deque()
            else:
                while timestamps and timestamps[0] <= cutoff:
                    timestamps.popleft()
            if len(timestamps) >= limit:
                retry_after = max(1, int(math.ceil(timestamps[0] + window_seconds - now)))
                if timestamps:
                    self._hits[key] = timestamps
                else:
                    self._hits.pop(key, None)
                return False, retry_after
            timestamps.append(now)
            self._hits[key] = timestamps
            return True, 0
