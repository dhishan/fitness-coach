"""Reusable input validators for security-sensitive fields."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from app.config import get_settings

ALLOWED_IMAGE_CONTENT_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
})

# Barcodes are 8-14 digit EAN/UPC codes. Reject anything else.
BARCODE_PATTERN = re.compile(r"^\d{8,14}$")

# Hint text users can attach to a photo estimate. Long enough for a real hint,
# short enough to make prompt-injection payloads hard to fit.
HINT_MAX_LEN = 200


def validate_food_image_url(url: str, user_id: str) -> bool:
    """Permit only GCS objects under the user's own food/ prefix.

    Blocks SSRF (no metadata endpoints, no internal hosts) and cross-user
    access (URL path must include the caller's user_id).
    """
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    if parsed.netloc != "storage.googleapis.com":
        return False
    bucket = get_settings().uploads_bucket
    if not bucket:
        return False
    expected_prefix = f"/{bucket}/food/{user_id}/"
    return parsed.path.startswith(expected_prefix)


def sanitize_hint(hint: str | None) -> str:
    """Trim user-supplied hint text to a safe length."""
    if not hint:
        return ""
    return str(hint).strip()[:HINT_MAX_LEN]
