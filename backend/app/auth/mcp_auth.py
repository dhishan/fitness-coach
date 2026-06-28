"""MCP authentication middleware and ContextVar.

Auth precedence:
  1. `Authorization: Bearer <google_oauth_token>` — a Google ID or access
     token issued for one of our configured OAuth client ids. Validated by
     `app.auth.google_oauth.verify_google_oauth_bearer`, then the email is
     mapped to our internal user_id via the `users` collection.
  2. `X-Mcp-User-Id` header — LOCAL DEV ONLY (ENVIRONMENT=development).

This is the auth model that lets claude.ai / chatgpt.com custom connectors
authenticate via Google OAuth. The previous Cloudflare Access JWT and
app-issued JWT paths were removed.

The resolved internal user_id is stashed in a ContextVar so MCP tool
functions can read it without re-implementing auth per tool. On a 401 the
middleware emits a `WWW-Authenticate` header pointing at our OAuth
protected-resource metadata so clients can discover how to authenticate.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from typing import Any

from cachetools import TTLCache

from fastapi import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth.google_oauth import GoogleOAuthError, verify_google_oauth_bearer
from app.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate limiting — per-user request cap + a global new-account backstop.
#
# In-memory sliding windows. Keyed by user_id (reliable post-auth), NOT client
# IP, which behind Cloudflare/Cloud Run is the proxy's. Cloud Run caps instances
# (max 2), so the effective per-user ceiling is at most ~limit * instances —
# adequate abuse protection without a shared store. Set the limit <= 0 to
# disable (tests/dev).
# ---------------------------------------------------------------------------

_rate_lock = threading.Lock()
_user_hits: dict[str, deque] = defaultdict(deque)
_provision_hits: deque = deque()


def _sliding_ok(dq: deque, limit: int, window: float, now: float) -> bool:
    cutoff = now - window
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= limit:
        return False
    dq.append(now)
    return True


def check_user_rate(user_id: str) -> bool:
    """Per-user sliding-window limiter. True = allowed, False = over the cap."""
    limit = get_settings().mcp_rate_limit_per_min
    if limit <= 0:
        return True
    now = time.monotonic()
    with _rate_lock:
        return _sliding_ok(_user_hits[user_id], limit, 60.0, now)


def check_provision_rate() -> bool:
    """Global backstop on new-account creation rate (the gateway path hides the
    client IP from the backend, so per-IP isn't reliable here). True = allowed."""
    limit = get_settings().mcp_provision_limit_per_hour
    if limit <= 0:
        return True
    now = time.monotonic()
    with _rate_lock:
        return _sliding_ok(_provision_hits, limit, 3600.0, now)

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

_uid_cache: TTLCache[str, str | None] = TTLCache(maxsize=64, ttl=300)


def _lookup_uid_by_email(email: str) -> str | None:
    """Return the Firestore user_id for the given email, or None (5-min cache)."""
    if email in _uid_cache:
        return _uid_cache[email]
    from app.firestore import get_db

    db = get_db()
    matches = list(
        db.collection("users").where("email", "==", email).limit(1).stream()
    )
    uid: str | None = matches[0].id if matches else None
    _uid_cache[email] = uid
    return uid


def _provision_user(sub: str, email: str) -> str:
    """Create a users/{google_sub} doc (matching the web sign-in shape) and
    return the uid. Used for public-signup auto-provisioning."""
    from datetime import datetime, timezone

    from app.firestore import get_db

    # Backstop: cap how fast new accounts can be created so an attacker can't
    # mass-provision identities (which would multiply per-user rate budgets).
    if not check_provision_rate():
        raise HTTPException(status_code=429, detail="Sign-up temporarily rate limited. Try again later.")

    get_db().collection("users").document(sub).set(
        {
            "email": email,
            "display_name": "",
            "preferred_units": "kg",
            "created_via": "mcp",
            "updated_at": datetime.now(timezone.utc),
        },
        merge=True,
    )
    _uid_cache[email] = sub
    return sub


def _resolve_or_provision(claims: dict) -> str:
    """Map a verified Google identity to an internal user_id, provisioning a
    new account when public signup is enabled.

    Raises HTTPException(401) if email is missing, HTTPException(403) if the
    user has no account and public signup is off.
    """
    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google token missing email claim")
    # Require a verified email BEFORE any email->user mapping, so an unverified
    # claim can't be used to resolve (and thus impersonate) an existing account.
    if not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google email not verified")
    uid = _lookup_uid_by_email(email)
    if uid is not None:
        return uid

    settings = get_settings()
    if settings.public_signup_enabled and claims.get("sub"):
        return _provision_user(str(claims["sub"]), email)

    raise HTTPException(
        status_code=403,
        detail=(
            f"User {email} authenticated with Google but has no account in the "
            "fitness tracker. Sign in to the web app once to create your account."
        ),
    )


def verify_gateway_assertion(token: str) -> dict:
    """Verify the HS256 assertion the Cloudflare OAuth gateway signs after it
    has authenticated the user upstream. Returns {email, sub, email_verified}."""
    import jwt

    secret = get_settings().mcp_gateway_secret
    if not secret:
        raise HTTPException(status_code=401, detail="gateway auth not configured")
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"invalid gateway assertion: {exc}")
    return {
        "email": payload.get("email"),
        "sub": payload.get("sub"),
        # the gateway only signs after a successful Google login, so trust it
        "email_verified": True,
    }


# ---------------------------------------------------------------------------
# Resolver — returns user_id or raises HTTPException(401/403).
# ---------------------------------------------------------------------------


def resolve_user_id_from_request(
    headers: dict[str, str],
    environment: str | None = None,
) -> str:
    """Validate auth headers and return the internal user_id.

    Args:
        headers: case-insensitive-friendly dict of request headers (lower-cased keys).
        environment: ENVIRONMENT value; read from settings when None.

    Raises:
        HTTPException(401): on missing/invalid credentials.
        HTTPException(403): if the Google email has no account in our user store.
    """
    settings = get_settings()
    env = environment if environment is not None else settings.environment

    # 1. Cloudflare OAuth gateway assertion (public connector path). The Worker
    #    already authenticated the user upstream via Google and signs {sub,email}.
    gw = headers.get("x-mcp-gateway-assertion")
    if gw:
        claims = verify_gateway_assertion(gw)
        uid = _resolve_or_provision(claims)
        logger.info(
            "mcp.auth source=gateway user_id=%s",
            uid,
            extra={"json_fields": {"event": "mcp_auth", "source": "gateway", "user_id": uid}},
        )
        return uid

    # 2. Direct Google OAuth bearer (private path: claude.ai with pasted client).
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        try:
            claims = verify_google_oauth_bearer(token)
        except GoogleOAuthError as exc:
            raise HTTPException(status_code=401, detail=f"Google OAuth bearer invalid: {exc}")
        uid = _resolve_or_provision(claims)
        logger.info(
            "mcp.auth source=google user_id=%s",
            uid,
            extra={"json_fields": {"event": "mcp_auth", "source": "google", "user_id": uid}},
        )
        return uid

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
        detail="MCP requires Authorization: Bearer <google_oauth_token> (or X-Mcp-User-Id in dev).",
    )


def _resource_metadata_url() -> str:
    """Base /.well-known/oauth-protected-resource URL derived from mcp_public_url."""
    settings = get_settings()
    base = (settings.mcp_public_url or "").rsplit("/mcp/", 1)[0] or (
        "https://mcp.fitness-tracker.blueelephants.org"
    )
    return f"{base}/.well-known/oauth-protected-resource"


# ---------------------------------------------------------------------------
# ASGI middleware.
# ---------------------------------------------------------------------------


class McpAuthMiddleware:
    """ASGI middleware that authenticates MCP requests and sets the ContextVar."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self._app(scope, receive, send)
            return

        raw_headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
        headers: dict[str, str] = {
            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in raw_headers
        }

        try:
            user_id = resolve_user_id_from_request(headers)
        except HTTPException as exc:
            extra: dict[str, str] = {}
            if exc.status_code == 401:
                # Tell the client where to find OAuth metadata (RFC 9728).
                extra["www-authenticate"] = (
                    'Bearer realm="mcp.fitness-tracker", '
                    f'resource_metadata="{_resource_metadata_url()}"'
                )
            await _send_json_response(send, exc.status_code, {"error": exc.detail}, extra)
            return

        # Per-user rate limit (abuse / DDoS protection on the public connector).
        if not check_user_rate(user_id):
            logger.warning(
                "mcp.rate_limited user_id=%s",
                user_id,
                extra={"json_fields": {"event": "mcp_rate_limited", "user_id": user_id}},
            )
            await _send_json_response(
                send, 429, {"error": "Rate limit exceeded. Slow down and retry shortly."},
                {"retry-after": "30"},
            )
            return

        # Attribute any captured error to this user (mirrors in-app chat).
        try:
            import sentry_sdk

            sentry_sdk.set_user({"id": user_id})
            sentry_sdk.set_tag("mcp.source", "remote")
        except Exception:
            pass

        token = _current_user_id.set(user_id)
        try:
            await self._app(scope, receive, send)
        finally:
            _current_user_id.reset(token)


async def _send_json_response(
    send: Send, status_code: int, body: Any, extra_headers: dict[str, str] | None = None
) -> None:
    """Send a minimal ASGI HTTP response."""
    encoded = json.dumps(body).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(encoded)).encode()),
    ]
    for k, v in (extra_headers or {}).items():
        headers.append((k.encode("latin-1"), v.encode("latin-1")))
    await send(
        {"type": "http.response.start", "status": status_code, "headers": headers}
    )
    await send({"type": "http.response.body", "body": encoded, "more_body": False})
