"""Tests for backend/app/auth/cloudflare.py.

Strategy: patch _get_jwks (JWKS fetch) and _kid_to_key (key lookup) so that
PyJWK construction is bypassed in most tests. jwt.decode is patched for the
decode step. No real network calls or cryptographic keys needed.
"""
from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

# Ensure CF settings are present before any import of the module under test.
os.environ.setdefault("CF_ACCESS_TEAM_DOMAIN", "https://test.cloudflareaccess.com")
os.environ.setdefault("CF_ACCESS_AUD", "test-aud")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_KID = "abc123"
_FAKE_JWKS = {
    "keys": [
        {
            "kid": _FAKE_KID,
            "kty": "RSA",
            "alg": "RS256",
            "use": "sig",
        }
    ]
}
_EMPTY_JWKS = {"keys": []}

_FAKE_CLAIMS = {
    "aud": "test-aud",
    "iss": "https://test.cloudflareaccess.com",
    "email": "user@example.com",
    "sub": "uid-1234",
}

_GOOD_TOKEN = "header.payload.sig"


def _fake_key() -> MagicMock:
    """Return a mock PyJWK whose `.key` attribute is a MagicMock."""
    k = MagicMock()
    k.key = MagicMock()
    return k


def _make_header(kid: str = _FAKE_KID, alg: str = "RS256") -> dict:
    return {"kid": kid, "alg": alg}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestVerifyCfAccessJwt:
    """Unit tests for verify_cf_access_jwt."""

    def setup_method(self):
        from app.auth.cloudflare import _fetch_jwks_cached
        _fetch_jwks_cached.cache_clear()

    # --- success path -------------------------------------------------------

    def test_success_returns_claims(self):
        """Happy path: valid token returns decoded claims."""
        from app.auth.cloudflare import verify_cf_access_jwt

        fake_key = _fake_key()
        with (
            patch("app.auth.cloudflare._get_jwks", return_value=_FAKE_JWKS),
            patch("app.auth.cloudflare._kid_to_key", return_value=fake_key),
            patch("jwt.get_unverified_header", return_value=_make_header()),
            patch("jwt.decode", return_value=_FAKE_CLAIMS),
        ):
            result = verify_cf_access_jwt(_GOOD_TOKEN)

        assert result["email"] == "user@example.com"

    def test_decode_called_with_rs256_pinned(self):
        """algorithms=["RS256"] must be passed to jwt.decode regardless of header."""
        from app.auth.cloudflare import verify_cf_access_jwt

        fake_key = _fake_key()
        with (
            patch("app.auth.cloudflare._get_jwks", return_value=_FAKE_JWKS),
            patch("app.auth.cloudflare._kid_to_key", return_value=fake_key),
            patch("jwt.get_unverified_header", return_value=_make_header()),
            patch("jwt.decode", return_value=_FAKE_CLAIMS) as mock_decode,
        ):
            verify_cf_access_jwt(_GOOD_TOKEN)

        args, kwargs = mock_decode.call_args
        # Third positional arg or keyword 'algorithms'
        if len(args) >= 3:
            assert args[2] == ["RS256"]
        else:
            assert kwargs["algorithms"] == ["RS256"]

    # --- bad audience -------------------------------------------------------

    def test_bad_aud_raises(self):
        """Wrong audience must raise CloudflareAuthError."""
        import jwt as pyjwt
        from app.auth.cloudflare import CloudflareAuthError, verify_cf_access_jwt

        fake_key = _fake_key()
        with (
            patch("app.auth.cloudflare._get_jwks", return_value=_FAKE_JWKS),
            patch("app.auth.cloudflare._kid_to_key", return_value=fake_key),
            patch("jwt.get_unverified_header", return_value=_make_header()),
            patch(
                "jwt.decode",
                side_effect=pyjwt.exceptions.InvalidAudienceError("aud mismatch"),
            ),
        ):
            with pytest.raises(CloudflareAuthError, match="audience"):
                verify_cf_access_jwt(_GOOD_TOKEN)

    # --- bad issuer ---------------------------------------------------------

    def test_bad_iss_raises(self):
        """Wrong issuer must raise CloudflareAuthError."""
        import jwt as pyjwt
        from app.auth.cloudflare import CloudflareAuthError, verify_cf_access_jwt

        fake_key = _fake_key()
        with (
            patch("app.auth.cloudflare._get_jwks", return_value=_FAKE_JWKS),
            patch("app.auth.cloudflare._kid_to_key", return_value=fake_key),
            patch("jwt.get_unverified_header", return_value=_make_header()),
            patch(
                "jwt.decode",
                side_effect=pyjwt.exceptions.InvalidIssuerError("iss mismatch"),
            ),
        ):
            with pytest.raises(CloudflareAuthError, match="issuer"):
                verify_cf_access_jwt(_GOOD_TOKEN)

    # --- kid miss + retry ---------------------------------------------------

    def test_kid_miss_triggers_refresh_and_succeeds(self):
        """On a kid miss, _get_jwks is called twice (force_refresh=True) and second succeeds."""
        from app.auth.cloudflare import verify_cf_access_jwt

        fake_key = _fake_key()
        # _get_jwks returns empty on first call, populated on second.
        jwks_side_effect = [_EMPTY_JWKS, _FAKE_JWKS]
        get_jwks_calls = {"n": 0}

        def fake_get_jwks(team_domain, force_refresh=False):
            result = jwks_side_effect[get_jwks_calls["n"]]
            get_jwks_calls["n"] += 1
            return result

        def fake_kid_to_key(jwks, kid):
            if jwks == _EMPTY_JWKS:
                return None
            return fake_key

        with (
            patch("app.auth.cloudflare._get_jwks", side_effect=fake_get_jwks),
            patch("app.auth.cloudflare._kid_to_key", side_effect=fake_kid_to_key),
            patch("jwt.get_unverified_header", return_value=_make_header()),
            patch("jwt.decode", return_value=_FAKE_CLAIMS),
        ):
            result = verify_cf_access_jwt(_GOOD_TOKEN)

        assert result["email"] == "user@example.com"
        assert get_jwks_calls["n"] == 2

    def test_kid_miss_both_attempts_raises(self):
        """If kid not found even after refresh, CloudflareAuthError is raised."""
        from app.auth.cloudflare import CloudflareAuthError, verify_cf_access_jwt

        with (
            patch("app.auth.cloudflare._get_jwks", return_value=_EMPTY_JWKS),
            patch("app.auth.cloudflare._kid_to_key", return_value=None),
            patch("jwt.get_unverified_header", return_value=_make_header()),
        ):
            with pytest.raises(CloudflareAuthError, match="kid"):
                verify_cf_access_jwt(_GOOD_TOKEN)

    # --- alg pinning --------------------------------------------------------

    def test_rs256_pinned_even_if_header_says_hs256(self):
        """Even with alg=HS256 in header, algorithms=["RS256"] is passed to decode."""
        from app.auth.cloudflare import verify_cf_access_jwt

        fake_key = _fake_key()
        with (
            patch("app.auth.cloudflare._get_jwks", return_value=_FAKE_JWKS),
            patch("app.auth.cloudflare._kid_to_key", return_value=fake_key),
            patch("jwt.get_unverified_header", return_value=_make_header(alg="HS256")),
            patch("jwt.decode", return_value=_FAKE_CLAIMS) as mock_decode,
        ):
            verify_cf_access_jwt(_GOOD_TOKEN)

        args, kwargs = mock_decode.call_args
        if len(args) >= 3:
            assert args[2] == ["RS256"]
        else:
            assert kwargs["algorithms"] == ["RS256"]

    # --- missing kid --------------------------------------------------------

    def test_missing_kid_raises(self):
        """JWT header without 'kid' must raise CloudflareAuthError immediately."""
        from app.auth.cloudflare import CloudflareAuthError, verify_cf_access_jwt

        with (
            patch("jwt.get_unverified_header", return_value={"alg": "RS256"}),  # no kid
        ):
            with pytest.raises(CloudflareAuthError, match="kid"):
                verify_cf_access_jwt(_GOOD_TOKEN)

    # --- not configured -----------------------------------------------------

    def test_not_configured_raises(self):
        """If CF settings are blank, raise CloudflareAuthError immediately."""
        from app.auth.cloudflare import CloudflareAuthError, verify_cf_access_jwt
        from app.config import get_settings

        settings = get_settings()
        original_domain = settings.cf_access_team_domain
        original_aud = settings.cf_access_aud

        object.__setattr__(settings, "cf_access_team_domain", "")
        object.__setattr__(settings, "cf_access_aud", "")
        try:
            with pytest.raises(CloudflareAuthError, match="not configured"):
                verify_cf_access_jwt(_GOOD_TOKEN)
        finally:
            object.__setattr__(settings, "cf_access_team_domain", original_domain)
            object.__setattr__(settings, "cf_access_aud", original_aud)
