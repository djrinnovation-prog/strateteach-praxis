"""Structured JSON logging, per-request correlation IDs, and in-process rate
limiting.

Self-hosted single-instance friendly: the rate limiter keeps counters in memory
(no Redis). Every request gets an X-Request-ID that is echoed in the response and
threaded through every log line, so a customer support ticket can quote one id and
we can pull the whole request's trail.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from collections import defaultdict, deque
from contextvars import ContextVar

from fastapi import Request
from fastapi.responses import JSONResponse

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

logger = logging.getLogger("algo770")


# ── Structured logging ────────────────────────────────────────────────────────

class _JsonFormatter(logging.Formatter):
    """One JSON object per line; cheap to ship to any log aggregator later."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", request_id_var.get()),
        }
        for key in ("method", "path", "status", "duration_ms", "client"):
            val = getattr(record, key, None)
            if val is not None:
                payload[key] = val
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    logging.getLogger("algo770").setLevel(level)


def _client(request: Request) -> str | None:
    # Behind the Caddy reverse proxy every request's socket peer is the proxy
    # itself, so request.client.host is identical for ALL users — which would
    # make the rate limiter a single shared bucket (everyone gets 429 together).
    # Use the real client IP from X-Forwarded-For (set by our own proxy), taking
    # the first hop. Fall back to the socket peer if the header is absent.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else None


# ── Request context + access log ──────────────────────────────────────────────

async def request_context_middleware(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    token = request_id_var.set(rid)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        dur = round((time.perf_counter() - start) * 1000, 1)
        logger.exception("request.error", extra={
            "request_id": rid, "method": request.method, "path": request.url.path,
            "duration_ms": dur, "client": _client(request),
        })
        try:  # best-effort: report to Sentry if it's configured
            import sentry_sdk
            sentry_sdk.capture_exception()
        except Exception:
            pass
        request_id_var.reset(token)
        return JSONResponse(status_code=500, content={"detail": "Internal error", "requestId": rid})
    dur = round((time.perf_counter() - start) * 1000, 1)
    logger.info("request", extra={
        "request_id": rid, "method": request.method, "path": request.url.path,
        "status": response.status_code, "duration_ms": dur, "client": _client(request),
    })
    response.headers["X-Request-ID"] = rid
    request_id_var.reset(token)
    return response


# ── Rate limiting (in-process fixed window) ───────────────────────────────────

_WINDOW = 60.0                     # seconds
# Public, abuse-prone auth endpoints get the tight per-IP bucket. Covers login +
# reset-token redeem (/auth/reset, which also prefix-matches /auth/reset-approved-login),
# plus the anti-bot-hardened public entry points: self-signup, the access-request
# signup form, and the "can't log in" password-reset request. (/auth/reset does NOT
# prefix-match /auth/password-reset-request, so that one is listed explicitly.)
_SENSITIVE_PREFIXES = (
    "/auth/login", "/auth/reset", "/auth/signup-request", "/auth/self-signup",
    "/auth/password-reset-request",
    "/v1/auth/login", "/v1/auth/reset", "/v1/auth/signup-request",
    "/v1/auth/self-signup", "/v1/auth/password-reset-request",
)
_LIMIT_SENSITIVE = 30              # login/reset/signup attempts per IP per minute
_LIMIT_DEFAULT = 600              # everything else, per IP per minute
_hits: dict[tuple[str, str], deque] = defaultdict(deque)


async def rate_limit_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    sensitive = any(path.startswith(p) for p in _SENSITIVE_PREFIXES)
    limit = _LIMIT_SENSITIVE if sensitive else _LIMIT_DEFAULT
    key = (_client(request) or "anon", "auth" if sensitive else "gen")

    now = time.time()
    dq = _hits[key]
    while dq and now - dq[0] > _WINDOW:
        dq.popleft()
    if len(dq) >= limit:
        retry = int(_WINDOW - (now - dq[0])) + 1
        logger.warning("ratelimit.block", extra={"path": path, "client": key[0]})
        return JSONResponse(status_code=429, content={"detail": "Too many requests"},
                            headers={"Retry-After": str(retry)})
    dq.append(now)
    if not dq:
        _hits.pop(key, None)
    return await call_next(request)
