"""Reusable input validators for security-sensitive fields."""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

from app.config import get_settings

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_CONTENT_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
})

# Barcodes: 8-14 digit EAN/UPC + GTIN-style; allow optional leading zeros,
# tolerate whitespace which some scanners include.
BARCODE_PATTERN = re.compile(r"^\d{8,14}$")

# Hint text users can attach to a photo estimate. Long enough for a real hint,
# short enough to make prompt-injection payloads hard to fit.
HINT_MAX_LEN = 200


def validate_food_image_url(url: str, user_id: str) -> bool:
    """Permit only GCS objects under the user's own food/ prefix."""
    return _check_food_image_url(url, user_id) is None


def _check_food_image_url(url: str, user_id: str) -> str | None:
    """Same checks as validate_food_image_url but returns the reason string
    when the URL is rejected (None on success). Used by the route to return
    structured error detail without leaking internals to the client."""
    if not url or not isinstance(url, str):
        return "empty_url"
    try:
        parsed = urlparse(url)
    except Exception:
        return "unparseable"
    if parsed.scheme != "https":
        return f"scheme={parsed.scheme}"
    if parsed.netloc != "storage.googleapis.com":
        return f"netloc={parsed.netloc}"
    bucket = get_settings().uploads_bucket
    if not bucket:
        return "no_bucket"
    expected_prefix = f"/{bucket}/food/{user_id}/"
    if not parsed.path.startswith(expected_prefix):
        return f"path={parsed.path} expected_prefix={expected_prefix}"
    return None


def sanitize_hint(hint: str | None) -> str:
    """Trim user-supplied hint text to a safe length."""
    if not hint:
        return ""
    return str(hint).strip()[:HINT_MAX_LEN]
