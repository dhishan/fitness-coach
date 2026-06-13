"""Tests for backend/app/auth/mcp_auth.py.

Tests cover every auth precedence path, the 401 fallthrough, and the ASGI
middleware behaviour. The resolver is tested directly via header dicts so no
real Starlette Request objects are needed.
"""
from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CF_ACCESS_TEAM_DOMAIN", "https://test.cloudflareaccess.com")
os.environ.setdefault("CF_ACCESS_AUD", "test-aud")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CF_CLAIMS = {
    "email": "user@example.com",
    "sub": "cf-sub",
    "aud": "test-aud",
    "iss": "https://test.cloudflareaccess.com",
}

_JWT_PAYLOAD = {"sub": "uid-jwt-user", "email": "jwt@example.com"}


def _make_jwt_token() -> str:
    """Create a real signed JWT using the test secret so verify_access_token passes."""
    from app.auth.tokens import create_access_token
    return create_access_token(user_id="uid-jwt-user", email="jwt@example.com")


# ---------------------------------------------------------------------------
# resolver tests
# ---------------------------------------------------------------------------


class TestResolveUserIdFromRequest:
    """Direct tests of the resolve_user_id_from_request function."""

    # --- Cloudflare path ----------------------------------------------------

    def test_cf_jwt_success(self):
        """CF Access JWT header resolves to the Firestore user_id."""
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch(
                "app.auth.mcp_auth.verify_cf_access_jwt",
                return_value=_CF_CLAIMS,
            ),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="fs-uid-123"),
        ):
            uid = resolve_user_id_from_request(
                {"cf-access-jwt-assertion": "fake.cf.token"}
            )

        assert uid == "fs-uid-123"

    def test_cf_jwt_invalid_raises_401(self):
        """Bad CF JWT raises HTTPException 401."""
        from fastapi import HTTPException
        from app.auth.cloudflare import CloudflareAuthError
        from app.auth.mcp_auth import resolve_user_id_from_request

        with patch(
            "app.auth.mcp_auth.verify_cf_access_jwt",
            side_effect=CloudflareAuthError("bad sig"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                resolve_user_id_from_request({"cf-access-jwt-assertion": "bad.token"})

        assert exc_info.value.status_code == 401
        assert "Cloudflare" in exc_info.value.detail

    def test_cf_jwt_missing_email_raises_401(self):
        """CF JWT without email claim raises 401."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with patch(
            "app.auth.mcp_auth.verify_cf_access_jwt",
            return_value={"sub": "uid"},  # no email
        ):
            with pytest.raises(HTTPException) as exc_info:
                resolve_user_id_from_request({"cf-access-jwt-assertion": "token"})

        assert exc_info.value.status_code == 401
        assert "email" in exc_info.value.detail

    def test_cf_jwt_user_not_in_firestore_raises_403(self):
        """CF JWT email not found in Firestore raises 403."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch(
                "app.auth.mcp_auth.verify_cf_access_jwt",
                return_value=_CF_CLAIMS,
            ),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value=None),
        ):
            with pytest.raises(HTTPException) as exc_info:
                resolve_user_id_from_request({"cf-access-jwt-assertion": "token"})

        assert exc_info.value.status_code == 403

    # --- Bearer JWT path ----------------------------------------------------

    def test_bearer_jwt_success(self):
        """Valid app-issued Bearer JWT resolves to sub claim."""
        from app.auth.mcp_auth import resolve_user_id_from_request

        token = _make_jwt_token()
        uid = resolve_user_id_from_request({"authorization": f"Bearer {token}"})
        assert uid == "uid-jwt-user"

    def test_bearer_jwt_invalid_raises_401(self):
        """Garbage bearer token raises HTTPException 401."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with pytest.raises(HTTPException) as exc_info:
            resolve_user_id_from_request({"authorization": "Bearer not.a.token"})

        assert exc_info.value.status_code == 401

    def test_bearer_jwt_missing_sub_raises_401(self):
        """Bearer JWT without 'sub' claim raises 401."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with patch("app.auth.mcp_auth.verify_access_token", return_value={}):
            with pytest.raises(HTTPException) as exc_info:
                resolve_user_id_from_request({"authorization": "Bearer sometoken"})

        assert exc_info.value.status_code == 401
        assert "subject" in exc_info.value.detail

    # --- Dev fallback path --------------------------------------------------

    def test_dev_header_in_dev_env(self):
        """X-Mcp-User-Id header accepted when environment='development'."""
        from app.auth.mcp_auth import resolve_user_id_from_request

        uid = resolve_user_id_from_request(
            {"x-mcp-user-id": "dev-user-42"},
            environment="development",
        )
        assert uid == "dev-user-42"

    def test_dev_header_outside_dev_env_raises_401(self):
        """X-Mcp-User-Id header is ignored when environment != 'development'."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with pytest.raises(HTTPException) as exc_info:
            resolve_user_id_from_request(
                {"x-mcp-user-id": "dev-user-42"},
                environment="production",
            )

        assert exc_info.value.status_code == 401

    def test_dev_header_outside_dev_env_test_also_401(self):
        """X-Mcp-User-Id is rejected even in 'test' environment."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with pytest.raises(HTTPException) as exc_info:
            resolve_user_id_from_request(
                {"x-mcp-user-id": "dev-user-42"},
                environment="test",
            )

        assert exc_info.value.status_code == 401

    # --- No auth headers ----------------------------------------------------

    def test_no_headers_raises_401(self):
        """Empty headers always raise HTTPException 401."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with pytest.raises(HTTPException) as exc_info:
            resolve_user_id_from_request({})

        assert exc_info.value.status_code == 401

    # --- CF takes precedence over Bearer ------------------------------------

    def test_cf_takes_precedence_over_bearer(self):
        """If both CF and Bearer headers present, CF path wins."""
        from app.auth.mcp_auth import resolve_user_id_from_request

        token = _make_jwt_token()
        with (
            patch(
                "app.auth.mcp_auth.verify_cf_access_jwt",
                return_value=_CF_CLAIMS,
            ),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="cf-user"),
        ):
            uid = resolve_user_id_from_request(
                {
                    "cf-access-jwt-assertion": "cf.token",
                    "authorization": f"Bearer {token}",
                }
            )

        assert uid == "cf-user"


# ---------------------------------------------------------------------------
# ContextVar tests
# ---------------------------------------------------------------------------


class TestContextVar:
    """Verify ContextVar is set and reset correctly."""

    def test_get_mcp_user_id_default_none(self):
        from app.auth.mcp_auth import get_mcp_user_id

        assert get_mcp_user_id() is None

    def test_contextvar_set_and_reset(self):
        from app.auth.mcp_auth import _current_user_id, get_mcp_user_id

        token = _current_user_id.set("test-uid")
        try:
            assert get_mcp_user_id() == "test-uid"
        finally:
            _current_user_id.reset(token)

        assert get_mcp_user_id() is None


# ---------------------------------------------------------------------------
# ASGI middleware tests
# ---------------------------------------------------------------------------


async def _run_middleware(
    middleware_app,
    headers: list[tuple[bytes, bytes]],
    path: str = "/mcp/",
) -> tuple[int, bytes]:
    """Drive the middleware with a minimal ASGI http scope; return (status, body)."""
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": headers,
        "query_string": b"",
    }

    sent_events: list[dict] = []

    async def fake_send(event: dict) -> None:
        sent_events.append(event)

    async def fake_receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    # The downstream app — just records it was called and sends a 200.
    downstream_called = {"flag": False}

    async def fake_downstream(scope, receive, send):
        downstream_called["flag"] = True
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    from app.auth.mcp_auth import McpAuthMiddleware

    app_with_middleware = McpAuthMiddleware(fake_downstream)
    await app_with_middleware(scope, fake_receive, fake_send)

    status = next(
        (e["status"] for e in sent_events if e.get("type") == "http.response.start"), 0
    )
    body = next(
        (e.get("body", b"") for e in sent_events if e.get("type") == "http.response.body"), b""
    )
    return status, body, downstream_called["flag"]


class TestMcpAuthMiddleware:
    """Integration tests for the ASGI McpAuthMiddleware."""

    @pytest.mark.asyncio
    async def test_middleware_passes_valid_bearer(self):
        """Valid Bearer JWT allows request through to downstream app."""
        token = _make_jwt_token()
        headers = [(b"authorization", f"Bearer {token}".encode())]
        status, body, downstream_called = await _run_middleware(None, headers)
        assert status == 200
        assert downstream_called is True

    @pytest.mark.asyncio
    async def test_middleware_rejects_no_auth(self):
        """Missing auth headers produce a 401 and downstream is NOT called."""
        status, body, downstream_called = await _run_middleware(None, [])
        assert status == 401
        assert downstream_called is False
        payload = json.loads(body)
        assert "error" in payload

    @pytest.mark.asyncio
    async def test_middleware_sets_contextvar(self):
        """After a successful auth, the ContextVar holds the resolved user_id."""
        from app.auth.mcp_auth import _current_user_id, McpAuthMiddleware

        token = _make_jwt_token()
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/mcp/",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
            "query_string": b"",
        }
        captured_uid: list[str | None] = []

        async def capturing_downstream(scope, receive, send):
            captured_uid.append(_current_user_id.get())
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [],
                }
            )
            await send({"type": "http.response.body", "body": b"{}", "more_body": False})

        mw = McpAuthMiddleware(capturing_downstream)

        async def fake_receive():
            return {"type": "http.request", "body": b""}

        events: list[dict] = []

        async def fake_send(e):
            events.append(e)

        await mw(scope, fake_receive, fake_send)

        assert captured_uid == ["uid-jwt-user"]
        # After the request, ContextVar is reset to None.
        assert _current_user_id.get() is None

    @pytest.mark.asyncio
    async def test_middleware_passes_lifespan_events(self):
        """Non-http scope types (e.g. lifespan) are forwarded without auth."""
        from app.auth.mcp_auth import McpAuthMiddleware

        scope = {"type": "lifespan"}
        called = {"flag": False}

        async def downstream(scope, receive, send):
            called["flag"] = True

        mw = McpAuthMiddleware(downstream)
        await mw(scope, None, None)
        assert called["flag"] is True
