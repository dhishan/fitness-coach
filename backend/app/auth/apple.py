"""Sign in with Apple ID token verification.

Apple signs identity tokens with its own keys; we fetch the JWKS from
https://appleid.apple.com/auth/keys and verify the signature.

Design notes:
  - RS256 hard-pinned (same reasoning as cloudflare.py: never trust the
    attacker-controlled `alg` header).
  - JWKS cached for 10 minutes via timestamp-bucketed lru_cache.
  - Audience is checked manually with a `startswith` against
    `settings.apple_audience_prefix` — AltStore rewrites our bundle id to
    e.g. `org.blueelephants.fitnesstracker.altstore.<hash>`, so we accept
    any audience starting with our prefix.
  - Issuer pinned to `https://appleid.apple.com`.
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
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_APPLE_ISSUER = "https://appleid.apple.com"


@lru_cache(maxsize=4)
def _fetch_apple_jwks_cached(bucket: int) -> dict[str, Any]:
    resp = requests.get(_APPLE_JWKS_URL, timeout=5.0)
    resp.raise_for_status()
    return resp.json()


def _get_apple_jwks(force_refresh: bool = False) -> dict[str, Any]:
    bucket = int(time.time()) // _TTL_SECONDS
    if force_refresh:
        _fetch_apple_jwks_cached.cache_clear()
    return _fetch_apple_jwks_cached(bucket)


def _kid_to_key(jwks: dict[str, Any], kid: str) -> PyJWK | None:
    for key_data in jwks.get("keys", []):
        if key_data.get("kid") == kid:
            return PyJWK(key_data)
    return None


def verify_apple_id_token(token: str) -> dict:
    """Verify an Apple identity token. Returns the decoded claims.

    Raises ValueError on any failure (bad signature, wrong iss, aud not
    matching the configured prefix, etc.).
    """
    settings = get_settings()
    prefix = settings.apple_audience_prefix
    if not prefix:
        raise ValueError("apple_audience_prefix not configured")

    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.exceptions.DecodeError as exc:
        raise ValueError(f"Malformed JWT header: {exc}") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise ValueError("JWT header missing 'kid'")

    key: PyJWK | None = None
    for force in (False, True):
        jwks = _get_apple_jwks(force_refresh=force)
        key = _kid_to_key(jwks, kid)
        if key is not None:
            break
    if key is None:
        raise ValueError(f"Apple signing key kid={kid!r} not found in JWKS after refresh")

    try:
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except jwt.exceptions.PyJWTError as exc:
        raise ValueError(f"Apple JWT verification failed: {exc}") from exc

    if claims.get("iss") != _APPLE_ISSUER:
        raise ValueError(f"Bad issuer: {claims.get('iss')!r}")

    aud = claims.get("aud")
    if not isinstance(aud, str) or not aud.startswith(prefix):
        raise ValueError(f"Audience {aud!r} does not match prefix {prefix!r}")

    return claims
