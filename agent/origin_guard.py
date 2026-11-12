"""Refuse state-changing requests that carry a foreign browser Origin."""

from __future__ import annotations

from collections.abc import Sequence

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class OriginGuardMiddleware:
    """Answer 403 to a non-safe request whose Origin is not allowed.

    A request without an Origin header is admitted: the web app's server calls
    this agent without one, while a browser always sends it on a POST. Written
    as a plain ASGI middleware so the streamed run response is never buffered.
    """

    def __init__(self, app: ASGIApp, allowed_origins: Sequence[str]) -> None:
        self.app = app
        self.allowed_origins = frozenset(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            for name, value in scope["headers"]:
                if name == b"origin" and value.decode("latin-1") not in self.allowed_origins:
                    response = JSONResponse({"detail": "Origin not allowed"}, status_code=403)
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)
