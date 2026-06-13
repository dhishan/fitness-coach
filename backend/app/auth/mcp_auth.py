"""MCP authentication middleware and ContextVar.

Auth precedence (in priority order):
  1. Cloudflare Access JWT in `Cf-Access-Jwt-Assertion` header (production).
  2. Bearer token = our own JWT issued by /api/v1/auth/google (fallback).
  3. `X-Mcp-User-Id` header (LOCAL DEV ONLY - gated by ENVIRONMENT=development).

The resolved internal user_id is stashed in a ContextVar so MCP tool
functions can read it without re-implementing auth for each tool.

The resolver function `resolve_user_id_from_request` accepts a plain dict of
headers so tests never need a real Starlette Request object.

The ASGI middleware `McpAuthMiddleware` wraps any downstream ASGI app, calls
the resolver, sets the ContextVar, and forwards the request. Unauthenticated
requests get a minimal JSON 401 without reaching the downstream app.
"""
from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from functools import lru_cache
from typing import Any

from fastapi import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth.cloudflare import CloudflareAuthError, verify_cf_access_jwt
from app.auth.tokens import verify_access_token
from app.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ContextVar — set per-request by McpAuthMiddleware; read by MCP tools.
# ---------------------------------------------------------------------------

_current_user_id: ContextVar[str | None] = ContextVar("mcp_user_id", default=None)


def get_mcp_user_id() -> str | None:
    """Return the authenticated user_id for the current MCP request, or None."""
    return _current_user_id.get()


# ---------------------------------------------------------------------------
# Firestore email->uid lookup (cached per process).
# ---------------------------------------------------------------------------


@lru_cache(maxsize=64)
def _lookup_uid_by_email(email: str) -> str | None:
    """Return the Firestore user_id (Google UID) for the given email, or None.

    Queries the `users` collection where email == `email`. The result is
    lru_cached so repeated MCP requests from the same user skip Firestore.
    Cache is process-scoped; a cold start re-queries automatically.
    """
    from app.firestore import get_db

    db = get_db()
    matches = list(
        db.collection("users").where("email", "==", email).limit(1).stream()
    )
    if not matches:
        return None
    return matches[0].id


# ---------------------------------------------------------------------------
# Resolver — returns user_id or raises HTTPException(401).
# ---------------------------------------------------------------------------


def resolve_user_id_from_request(
    headers: dict[str, str],
    environment: str | None = None,
) -> str:
    """Validate auth headers and return the internal user_id (Google UID).

    Args:
        headers: A case-insensitive-friendly dict of HTTP request headers.
                 Callers should lower-case keys before passing, or use a
                 Starlette Headers-like object coerced to dict.
        environment: The ENVIRONMENT setting value. If None, reads from
                     settings. Exposed as a parameter so tests can inject it
                     without patching settings.

    Raises:
        HTTPException(401): On any auth failure or missing credentials.
        HTTPException(403): If the CF Access email is not in our user store.
    """
    settings = get_settings()
    env = environment if environment is not None else settings.environment

    # 1. Cloudflare Access JWT (production path).
    cf_jwt = headers.get("cf-access-jwt-assertion")
    if cf_jwt:
        try:
            claims = verify_cf_access_jwt(cf_jwt)
        except CloudflareAuthError as exc:
            raise HTTPException(
                status_code=401, detail=f"Cloudflare Access JWT invalid: {exc}"
            )
        email = claims.get("email")
        if not email:
            raise HTTPException(
                status_code=401, detail="Cloudflare JWT missing email claim"
            )
        uid = _lookup_uid_by_email(email)
        if uid is None:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"User {email} authenticated with Cloudflare Access but has no "
                    "account in the fitness tracker. Sign in to the web app once to "
                    "create your account."
                ),
            )
        logger.info(
            "mcp.auth source=cf user_id=%s",
            uid,
            extra={"json_fields": {"event": "mcp_auth", "source": "cf", "user_id": uid}},
        )
        return uid

    # 2. Bearer token: our own app JWT.
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        try:
            payload = verify_access_token(token)
        except Exception as exc:
            raise HTTPException(
                status_code=401, detail=f"Invalid bearer token: {exc}"
            )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject")
        logger.info(
            "mcp.auth source=jwt user_id=%s",
            user_id,
            extra={"json_fields": {"event": "mcp_auth", "source": "jwt", "user_id": user_id}},
        )
        return user_id

    # 3. Local-dev escape hatch — header-based user injection.
    if env == "development":
        dev_user = headers.get("x-mcp-user-id")
        if dev_user:
            logger.info(
                "mcp.auth source=dev user_id=%s",
                dev_user,
                extra={"json_fields": {"event": "mcp_auth", "source": "dev", "user_id": dev_user}},
            )
            return dev_user

    raise HTTPException(
        status_code=401,
        detail="MCP requires Cloudflare Access JWT, Bearer token, or X-Mcp-User-Id (dev only).",
    )


# ---------------------------------------------------------------------------
# ASGI middleware.
# ---------------------------------------------------------------------------


class McpAuthMiddleware:
    """ASGI middleware that authenticates MCP requests and sets the ContextVar.

    Usage:
        asgi_app = mcp.streamable_http_app()
        wrapped = McpAuthMiddleware(asgi_app)
        app.mount("/mcp", wrapped)
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            # Pass-through for lifespan events etc.
            await self._app(scope, receive, send)
            return

        # Build a header dict (lower-cased keys) from the scope.
        raw_headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
        headers: dict[str, str] = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in raw_headers
        }

        try:
            user_id = resolve_user_id_from_request(headers)
        except HTTPException as exc:
            await _send_json_response(send, exc.status_code, {"error": exc.detail})
            return

        token = _current_user_id.set(user_id)
        try:
            await self._app(scope, receive, send)
        finally:
            _current_user_id.reset(token)


async def _send_json_response(send: Send, status_code: int, body: Any) -> None:
    """Send a minimal ASGI HTTP response."""
    encoded = json.dumps(body).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(encoded)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": encoded, "more_body": False})
