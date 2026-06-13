"""Cloudflare Access JWT verification.

Cloudflare Access fronts the hosted /mcp endpoint in production. When a
request arrives, CF Access has already authenticated the user via Google
OAuth and injects a signed JWT in the `Cf-Access-Jwt-Assertion` header.
This module verifies that JWT against Cloudflare's public JWKS endpoint and
returns the verified claims (most importantly `email`).

Design notes:
  - RS256 is hard-pinned. We never read the `alg` claim from the (attacker-
    controlled) JWT header — that would expose us to alg-confusion attacks
    (e.g. HS256 with the RSA public key as HMAC secret, or alg=none).
  - JWKS is fetched from `{team_domain}/cdn-cgi/access/certs` and cached
    for 10 minutes via a timestamp-bucketed lru_cache. On a kid miss (key
    rotation) we invalidate and retry once.
  - PyJWT is used for decode — same library the rest of the app uses.
  - `requests` is used for the JWKS fetch — already a dep, no new transitive.
"""
from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Any

import jwt
import requests
from jwt import PyJWK

from app.config import get_settings

logger = logging.getLogger(__name__)

_TTL_SECONDS = 600  # 10 minutes


class CloudflareAuthError(Exception):
    """Raised when CF Access JWT verification fails."""


# ---------------------------------------------------------------------------
# JWKS cache — lru_cache keyed on (team_domain, bucket) so different domains
# get separate entries and the bucket (timestamp // TTL) auto-expires old ones.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=32)
def _fetch_jwks_cached(team_domain: str, bucket: int) -> dict[str, Any]:
    """Fetch and parse the JWKS for `team_domain`, cached per 10-min bucket."""
    url = f"{team_domain}/cdn-cgi/access/certs"
    try:
        resp = requests.get(url, timeout=5.0)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise CloudflareAuthError(f"Failed to fetch JWKS from {url}: {exc}") from exc
    return resp.json()


def _get_jwks(team_domain: str, force_refresh: bool = False) -> dict[str, Any]:
    """Return the JWKS, optionally bypassing the cache."""
    bucket = int(time.time()) // _TTL_SECONDS
    if force_refresh:
        # Invalidate the current bucket entry so the next call re-fetches.
        _fetch_jwks_cached.cache_clear()
        # Re-fetch under the same bucket so new data is cached for the rest
        # of the bucket window.
    return _fetch_jwks_cached(team_domain, bucket)


def _kid_to_key(jwks: dict[str, Any], kid: str) -> PyJWK | None:
    """Find the key with the given kid in the JWKS and return a PyJWK object."""
    for key_data in jwks.get("keys", []):
        if key_data.get("kid") == kid:
            return PyJWK(key_data)
    return None


def verify_cf_access_jwt(token: str) -> dict:
    """Verify a Cloudflare Access JWT. Returns the decoded claims on success.

    Raises CloudflareAuthError on any failure (bad signature, wrong AUD,
    wrong ISS, expired, missing kid, unknown kid, etc.).
    """
    settings = get_settings()

    if not settings.cf_access_team_domain or not settings.cf_access_aud:
        raise CloudflareAuthError(
            "Cloudflare Access not configured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD."
        )

    team_domain = settings.cf_access_team_domain
    aud = settings.cf_access_aud

    # Decode the header without verification to get the kid.
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.exceptions.DecodeError as exc:
        raise CloudflareAuthError(f"Malformed JWT header: {exc}") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise CloudflareAuthError("JWT header missing 'kid'")

    # Try cached JWKS; on kid miss invalidate and retry once (key rotation).
    key: PyJWK | None = None
    for attempt, force in enumerate([False, True]):
        jwks = _get_jwks(team_domain, force_refresh=force)
        key = _kid_to_key(jwks, kid)
        if key is not None:
            break
    if key is None:
        raise CloudflareAuthError(f"Signing key kid={kid!r} not found in JWKS after refresh")

    # Decode and verify — RS256 hard-pinned, audience + issuer checked.
    try:
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=aud,
            issuer=team_domain,
        )
    except jwt.exceptions.InvalidAudienceError as exc:
        raise CloudflareAuthError(f"JWT audience mismatch: {exc}") from exc
    except jwt.exceptions.InvalidIssuerError as exc:
        raise CloudflareAuthError(f"JWT issuer mismatch: {exc}") from exc
    except jwt.exceptions.PyJWTError as exc:
        raise CloudflareAuthError(f"JWT verification failed: {exc}") from exc

    return claims
