import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status


@dataclass
class RateLimitBucket:
    timestamps: deque[float]


class InMemoryRateLimiter:
    """Simple per-key-and-route sliding window limiter for LAN deployments."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, RateLimitBucket] = defaultdict(lambda: RateLimitBucket(deque()))
        self._lock = asyncio.Lock()

    async def check(self, request: Request) -> None:
        api_key = request.headers.get("x-homeplane-key", "anonymous")
        identifier = f"{api_key}:{request.method}:{request.url.path}"
        cutoff = time.monotonic() - self.window_seconds

        async with self._lock:
            bucket = self._buckets[identifier].timestamps
            while bucket and bucket[0] < cutoff:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded",
                )

            bucket.append(time.monotonic())
