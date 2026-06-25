"""Tests for backend/app/auth/mcp_auth.py (Google-OAuth MCP auth).

The resolver is tested directly via header dicts; the ASGI middleware is
driven with a minimal scope. Google token validation is mocked.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

_GOOGLE_CLAIMS = {"email": "user@example.com", "sub": "g-sub", "email_verified": True}


# ---------------------------------------------------------------------------
# resolver tests
# ---------------------------------------------------------------------------


class TestResolveUserIdFromRequest:
    def test_google_bearer_success(self):
        """A valid Google bearer resolves email -> Firestore user_id."""
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=_GOOGLE_CLAIMS),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="fs-uid-123"),
        ):
            uid = resolve_user_id_from_request({"authorization": "Bearer g.token.here"})
        assert uid == "fs-uid-123"

    def test_google_bearer_invalid_raises_401(self):
        from fastapi import HTTPException
        from app.auth.google_oauth import GoogleOAuthError
        from app.auth.mcp_auth import resolve_user_id_from_request

        with patch(
            "app.auth.mcp_auth.verify_google_oauth_bearer",
            side_effect=GoogleOAuthError("bad token"),
        ):
            with pytest.raises(HTTPException) as exc:
                resolve_user_id_from_request({"authorization": "Bearer bad"})
        assert exc.value.status_code == 401
        assert "Google" in exc.value.detail

    def test_google_bearer_missing_email_raises_401(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value={"sub": "x"}):
            with pytest.raises(HTTPException) as exc:
                resolve_user_id_from_request({"authorization": "Bearer t"})
        assert exc.value.status_code == 401
        assert "email" in exc.value.detail

    def test_google_email_not_in_firestore_raises_403(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=_GOOGLE_CLAIMS),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value=None),
        ):
            with pytest.raises(HTTPException) as exc:
                resolve_user_id_from_request({"authorization": "Bearer t"})
        assert exc.value.status_code == 403

    # --- dev fallback ---

    def test_dev_header_in_dev_env(self):
        from app.auth.mcp_auth import resolve_user_id_from_request
        uid = resolve_user_id_from_request({"x-mcp-user-id": "dev-42"}, environment="development")
        assert uid == "dev-42"

    def test_dev_header_outside_dev_env_raises_401(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request
        with pytest.raises(HTTPException) as exc:
            resolve_user_id_from_request({"x-mcp-user-id": "dev-42"}, environment="production")
        assert exc.value.status_code == 401

    def test_no_headers_raises_401(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request
        with pytest.raises(HTTPException) as exc:
            resolve_user_id_from_request({})
        assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# ContextVar tests
# ---------------------------------------------------------------------------


class TestContextVar:
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


async def _run_middleware(headers, path="/mcp/"):
    scope = {"type": "http", "method": "POST", "path": path, "headers": headers, "query_string": b""}
    sent_events: list[dict] = []

    async def fake_send(event):
        sent_events.append(event)

    async def fake_receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    downstream_called = {"flag": False}

    async def fake_downstream(scope, receive, send):
        downstream_called["flag"] = True
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    from app.auth.mcp_auth import McpAuthMiddleware

    await McpAuthMiddleware(fake_downstream)(scope, fake_receive, fake_send)
    start = next((e for e in sent_events if e.get("type") == "http.response.start"), {})
    body = next((e.get("body", b"") for e in sent_events if e.get("type") == "http.response.body"), b"")
    return start.get("status", 0), dict(start.get("headers", [])), body, downstream_called["flag"]


class TestMcpAuthMiddleware:
    @pytest.mark.asyncio
    async def test_middleware_passes_valid_google_bearer(self):
        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=_GOOGLE_CLAIMS),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="fs-uid-1"),
        ):
            status, _h, _b, called = await _run_middleware([(b"authorization", b"Bearer g.tok")])
        assert status == 200
        assert called is True

    @pytest.mark.asyncio
    async def test_middleware_rejects_no_auth_with_www_authenticate(self):
        status, headers, body, called = await _run_middleware([])
        assert status == 401
        assert called is False
        # 401 advertises where to find OAuth metadata (RFC 9728)
        wa = headers.get(b"www-authenticate", b"").decode()
        assert "resource_metadata=" in wa
        assert "error" in json.loads(body)

    @pytest.mark.asyncio
    async def test_middleware_sets_contextvar(self):
        from app.auth.mcp_auth import _current_user_id, McpAuthMiddleware

        scope = {"type": "http", "method": "POST", "path": "/mcp/",
                 "headers": [(b"authorization", b"Bearer g.tok")], "query_string": b""}
        captured: list = []

        async def downstream(scope, receive, send):
            captured.append(_current_user_id.get())
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}", "more_body": False})

        async def fake_receive():
            return {"type": "http.request", "body": b""}

        async def fake_send(e):
            pass

        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=_GOOGLE_CLAIMS),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="fs-uid-1"),
        ):
            await McpAuthMiddleware(downstream)(scope, fake_receive, fake_send)

        assert captured == ["fs-uid-1"]
        assert _current_user_id.get() is None

    @pytest.mark.asyncio
    async def test_middleware_passes_lifespan_events(self):
        from app.auth.mcp_auth import McpAuthMiddleware
        called = {"flag": False}

        async def downstream(scope, receive, send):
            called["flag"] = True

        await McpAuthMiddleware(downstream)({"type": "lifespan"}, None, None)
        assert called["flag"] is True


# ---------------------------------------------------------------------------
# Discovery endpoints (well-known)
# ---------------------------------------------------------------------------


def test_protected_resource_discovery(client):
    r = client.get("/.well-known/oauth-protected-resource")
    assert r.status_code == 200
    body = r.json()
    assert body["authorization_servers"] == ["https://accounts.google.com"]
    assert body["resource"].endswith("/mcp/")


def test_protected_resource_path_aware_variant(client):
    r = client.get("/.well-known/oauth-protected-resource/mcp")
    assert r.status_code == 200
    assert "resource" in r.json()


def test_authorization_server_discovery(client):
    r = client.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200
    body = r.json()
    assert body["issuer"] == "https://accounts.google.com"
    assert body["token_endpoint"] == "https://oauth2.googleapis.com/token"
    assert "client_id" in body
