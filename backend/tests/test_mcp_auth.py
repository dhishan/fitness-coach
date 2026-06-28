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

    def test_google_email_not_in_firestore_raises_403_when_signup_off(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=_GOOGLE_CLAIMS),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value=None),
            patch("app.auth.mcp_auth.get_settings") as mock_s,
        ):
            mock_s.return_value.public_signup_enabled = False
            with pytest.raises(HTTPException) as exc:
                resolve_user_id_from_request({"authorization": "Bearer t"})
        assert exc.value.status_code == 403

    def test_public_signup_provisions_new_verified_user(self):
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=_GOOGLE_CLAIMS),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value=None),
            patch("app.auth.mcp_auth._provision_user", return_value="g-sub") as prov,
            patch("app.auth.mcp_auth.get_settings") as mock_s,
        ):
            mock_s.return_value.public_signup_enabled = True
            uid = resolve_user_id_from_request({"authorization": "Bearer t"})
        assert uid == "g-sub"
        prov.assert_called_once_with("g-sub", "user@example.com")

    def test_unverified_email_rejected_before_lookup(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        unverified = {"email": "u@example.com", "sub": "s", "email_verified": False}
        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=unverified),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value=None),
            patch("app.auth.mcp_auth.get_settings") as mock_s,
        ):
            mock_s.return_value.public_signup_enabled = True
            with pytest.raises(HTTPException) as exc:
                resolve_user_id_from_request({"authorization": "Bearer t"})
        assert exc.value.status_code == 401

    def test_unverified_email_cannot_resolve_existing_account(self):
        """Security: an unverified email must NOT map to an existing user_id,
        else a forged/unverified claim could impersonate that account."""
        from fastapi import HTTPException
        from app.auth.mcp_auth import resolve_user_id_from_request

        unverified = {"email": "victim@example.com", "sub": "attacker", "email_verified": False}
        with (
            patch("app.auth.mcp_auth.verify_google_oauth_bearer", return_value=unverified),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="victim-uid") as mock_lookup,
            patch("app.auth.mcp_auth.get_settings") as mock_s,
        ):
            mock_s.return_value.public_signup_enabled = True
            with pytest.raises(HTTPException) as exc:
                resolve_user_id_from_request({"authorization": "Bearer t"})
        assert exc.value.status_code == 401
        mock_lookup.assert_not_called()  # rejected before the email->uid lookup

    # --- gateway assertion path (public Worker) ---

    def test_gateway_assertion_resolves_user(self):
        from app.auth.mcp_auth import resolve_user_id_from_request

        with (
            patch("app.auth.mcp_auth.verify_gateway_assertion",
                  return_value={"email": "user@example.com", "sub": "g-sub", "email_verified": True}),
            patch("app.auth.mcp_auth._lookup_uid_by_email", return_value="fs-uid-9"),
        ):
            uid = resolve_user_id_from_request({"x-mcp-gateway-assertion": "signed.jwt"})
        assert uid == "fs-uid-9"

    def test_gateway_assertion_invalid_signature_401(self):
        from fastapi import HTTPException
        from app.auth.mcp_auth import verify_gateway_assertion

        with patch("app.auth.mcp_auth.get_settings") as mock_s:
            mock_s.return_value.mcp_gateway_secret = "shh"
            with pytest.raises(HTTPException) as exc:
                verify_gateway_assertion("not.a.validjwt")
        assert exc.value.status_code == 401

    def test_gateway_assertion_roundtrip(self):
        """A token signed with the gateway secret verifies and yields the email."""
        import jwt
        from app.auth.mcp_auth import verify_gateway_assertion

        with patch("app.auth.mcp_auth.get_settings") as mock_s:
            mock_s.return_value.mcp_gateway_secret = "shared-secret"
            token = jwt.encode({"sub": "s1", "email": "a@b.com"}, "shared-secret", algorithm="HS256")
            claims = verify_gateway_assertion(token)
        assert claims["email"] == "a@b.com"
        assert claims["sub"] == "s1"

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


class TestRateLimiting:
    """Per-user request cap + global provisioning backstop (abuse protection)."""

    def test_user_rate_blocks_over_limit(self):
        from unittest.mock import patch
        from app.auth import mcp_auth

        mcp_auth._user_hits.clear()
        with patch("app.auth.mcp_auth.get_settings") as ms:
            ms.return_value.mcp_rate_limit_per_min = 3
            assert mcp_auth.check_user_rate("u1")       # 1
            assert mcp_auth.check_user_rate("u1")       # 2
            assert mcp_auth.check_user_rate("u1")       # 3
            assert not mcp_auth.check_user_rate("u1")   # 4 -> over cap
            assert mcp_auth.check_user_rate("u2")       # other users unaffected

    def test_user_rate_disabled_when_zero(self):
        from unittest.mock import patch
        from app.auth import mcp_auth

        mcp_auth._user_hits.clear()
        with patch("app.auth.mcp_auth.get_settings") as ms:
            ms.return_value.mcp_rate_limit_per_min = 0
            assert all(mcp_auth.check_user_rate("u1") for _ in range(200))

    def test_provision_backstop_blocks_over_limit(self):
        from unittest.mock import patch
        from app.auth import mcp_auth

        mcp_auth._provision_hits.clear()
        with patch("app.auth.mcp_auth.get_settings") as ms:
            ms.return_value.mcp_provision_limit_per_hour = 2
            assert mcp_auth.check_provision_rate()
            assert mcp_auth.check_provision_rate()
            assert not mcp_auth.check_provision_rate()

    def test_provision_user_raises_429_when_backstopped(self):
        from unittest.mock import patch
        from fastapi import HTTPException
        from app.auth import mcp_auth

        with patch("app.auth.mcp_auth.check_provision_rate", return_value=False):
            with pytest.raises(HTTPException) as exc:
                mcp_auth._provision_user("sub", "e@example.com")
        assert exc.value.status_code == 429
