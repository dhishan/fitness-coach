"""P0/P1 security regression tests."""
from unittest.mock import patch

import pytest

from app.security.validators import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    BARCODE_PATTERN,
    HINT_MAX_LEN,
    sanitize_hint,
    validate_food_image_url,
)


# ---------------------------------------------------------------------------
# image_url SSRF / cross-user validator (P0-B)
# ---------------------------------------------------------------------------

@pytest.fixture()
def configured_bucket():
    with patch("app.security.validators.get_settings") as mock:
        mock.return_value.uploads_bucket = "test-bucket"
        yield


class TestImageUrlValidator:
    def test_accepts_own_user_https_gcs(self, configured_bucket):
        ok = validate_food_image_url(
            "https://storage.googleapis.com/test-bucket/food/user_abc/photo.jpg",
            "user_abc",
        )
        assert ok is True

    def test_rejects_other_user_path(self, configured_bucket):
        bad = validate_food_image_url(
            "https://storage.googleapis.com/test-bucket/food/other_user/photo.jpg",
            "user_abc",
        )
        assert bad is False

    def test_rejects_gcp_metadata_endpoint(self, configured_bucket):
        bad = validate_food_image_url(
            "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
            "user_abc",
        )
        assert bad is False

    def test_rejects_internal_host(self, configured_bucket):
        for url in (
            "http://localhost:8080/secret",
            "https://internal-service:9000/file.jpg",
            "http://10.0.0.1/file.jpg",
        ):
            assert validate_food_image_url(url, "user_abc") is False

    def test_rejects_http_scheme(self, configured_bucket):
        bad = validate_food_image_url(
            "http://storage.googleapis.com/test-bucket/food/user_abc/photo.jpg",
            "user_abc",
        )
        assert bad is False

    def test_rejects_wrong_bucket(self, configured_bucket):
        bad = validate_food_image_url(
            "https://storage.googleapis.com/other-bucket/food/user_abc/photo.jpg",
            "user_abc",
        )
        assert bad is False

    def test_rejects_empty(self, configured_bucket):
        assert validate_food_image_url("", "user_abc") is False
        assert validate_food_image_url(None, "user_abc") is False  # type: ignore

    def test_rejects_when_bucket_unconfigured(self):
        with patch("app.security.validators.get_settings") as mock:
            mock.return_value.uploads_bucket = ""
            assert validate_food_image_url(
                "https://storage.googleapis.com/x/food/user_abc/p.jpg", "user_abc"
            ) is False


# ---------------------------------------------------------------------------
# content_type allowlist for signed uploads (P0-C)
# ---------------------------------------------------------------------------

class TestContentTypeAllowlist:
    def test_allowed_types(self):
        for ct in ("image/jpeg", "image/png", "image/webp", "image/heic"):
            assert ct in ALLOWED_IMAGE_CONTENT_TYPES

    def test_blocks_html_xss_attempt(self):
        assert "text/html" not in ALLOWED_IMAGE_CONTENT_TYPES

    def test_blocks_svg(self):
        # SVG can carry JS; explicitly NOT allowed
        assert "image/svg+xml" not in ALLOWED_IMAGE_CONTENT_TYPES


# ---------------------------------------------------------------------------
# Barcode pattern (P1-E)
# ---------------------------------------------------------------------------

class TestBarcodePattern:
    def test_accepts_8_to_14_digits(self):
        for code in ("12345678", "123456789012", "12345678901234"):
            assert BARCODE_PATTERN.match(code) is not None

    def test_rejects_path_traversal(self):
        assert BARCODE_PATTERN.match("../../etc/passwd") is None

    def test_rejects_non_digit(self):
        assert BARCODE_PATTERN.match("abc12345") is None

    def test_rejects_too_short_too_long(self):
        assert BARCODE_PATTERN.match("1234567") is None
        assert BARCODE_PATTERN.match("123456789012345") is None


# ---------------------------------------------------------------------------
# Hint sanitization (P2-A)
# ---------------------------------------------------------------------------

class TestHintSanitization:
    def test_caps_length(self):
        long = "x" * (HINT_MAX_LEN + 100)
        assert len(sanitize_hint(long)) == HINT_MAX_LEN

    def test_strips_whitespace(self):
        assert sanitize_hint("  chicken rice  ") == "chicken rice"

    def test_handles_none(self):
        assert sanitize_hint(None) == ""
        assert sanitize_hint("") == ""


# ---------------------------------------------------------------------------
# JWT secret startup assertion (P0-D)
# ---------------------------------------------------------------------------

class TestJwtSecretAssertion:
    def test_dev_secret_blocked_in_production(self, monkeypatch):
        # Re-import main module with production env + default secret. Must raise.
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv("JWT_SECRET_KEY", "dev-only-secret")
        from app.config import get_settings
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
            import importlib
            import app.main
            importlib.reload(app.main)

    def teardown_method(self):
        # Restore test environment so subsequent tests work
        import os
        os.environ["ENVIRONMENT"] = "test"
        os.environ["JWT_SECRET_KEY"] = "test-secret"
        from app.config import get_settings
        get_settings.cache_clear()
        import importlib
        import app.main
        importlib.reload(app.main)


# ---------------------------------------------------------------------------
# Integration: endpoint-level enforcement
# ---------------------------------------------------------------------------

@pytest.fixture()
def auth_headers():
    from app.auth.tokens import create_access_token
    return {"Authorization": f"Bearer {create_access_token('u1', 'iamdhishan@gmail.com')}"}


class TestEndpointEnforcement:
    def test_photo_endpoint_rejects_metadata_url(self, client, auth_headers, monkeypatch):
        monkeypatch.setenv("UPLOADS_BUCKET", "test-bucket")
        from app.config import get_settings
        get_settings.cache_clear()
        r = client.post(
            "/api/v1/nutrition/estimate/photo",
            headers=auth_headers,
            json={"image_url": "http://169.254.169.254/computeMetadata/v1/"},
        )
        assert r.status_code == 422

    def test_photo_endpoint_rejects_other_user_path(self, client, auth_headers, monkeypatch):
        monkeypatch.setenv("UPLOADS_BUCKET", "test-bucket")
        from app.config import get_settings
        get_settings.cache_clear()
        r = client.post(
            "/api/v1/nutrition/estimate/photo",
            headers=auth_headers,
            json={"image_url": "https://storage.googleapis.com/test-bucket/food/other_user/p.jpg"},
        )
        assert r.status_code == 422

    def test_upload_endpoint_rejects_html_content_type(self, client, auth_headers, monkeypatch):
        monkeypatch.setenv("UPLOADS_BUCKET", "test-bucket")
        from app.config import get_settings
        get_settings.cache_clear()
        r = client.post(
            "/api/v1/uploads/sign-food-photo?content_type=text/html",
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_barcode_endpoint_rejects_non_digit(self, client, auth_headers):
        r = client.get("/api/v1/nutrition/barcode/notabarcode", headers=auth_headers)
        # FastAPI returns 422 for path validation failures
        assert r.status_code == 422

