"""Tests for the signed-URL upload endpoint."""
from unittest.mock import patch

BASE = "app.routers.uploads"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_sign_food_photo_no_bucket_configured(client):
    """503 when uploads_bucket is empty."""
    from app.config import get_settings
    s = get_settings()
    original = s.uploads_bucket
    object.__setattr__(s, "uploads_bucket", "")
    try:
        r = client.post("/api/v1/uploads/sign-food-photo", headers=_auth(client))
        assert r.status_code == 503
        assert "uploads not configured" in r.json()["detail"]
    finally:
        object.__setattr__(s, "uploads_bucket", original)


def test_sign_food_photo_returns_urls(client):
    """200 with upload_url, gs_url, public_url when bucket configured and _sign_url mocked."""
    from app.config import get_settings
    s = get_settings()
    original = s.uploads_bucket
    object.__setattr__(s, "uploads_bucket", "fitness-tracker-uploads-test")
    try:
        with patch(f"{BASE}._sign_url", return_value="https://fake-signed-url.example.com/upload"):
            r = client.post(
                "/api/v1/uploads/sign-food-photo",
                params={"content_type": "image/jpeg"},
                headers=_auth(client),
            )
        assert r.status_code == 200
        body = r.json()
        assert body["upload_url"] == "https://fake-signed-url.example.com/upload"
        assert body["gs_url"].startswith("gs://fitness-tracker-uploads-test/food/u1/")
        assert body["public_url"].startswith(
            "https://storage.googleapis.com/fitness-tracker-uploads-test/food/u1/"
        )
        assert body["content_type"] == "image/jpeg"
    finally:
        object.__setattr__(s, "uploads_bucket", original)


def test_sign_food_photo_requires_auth(client):
    """401 without Authorization header."""
    r = client.post("/api/v1/uploads/sign-food-photo")
    assert r.status_code == 401
