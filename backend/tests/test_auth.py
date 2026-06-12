from unittest.mock import patch


def _fake_idinfo(email="iamdhishan@gmail.com"):
    return {"sub": "google-uid-1", "email": email, "name": "Dhishan", "email_verified": True}


def test_auth_google_success(client, mock_db):
    with patch("app.auth.router.verify_google_id_token", return_value=_fake_idinfo()):
        r = client.post("/api/v1/auth/google", json={"id_token": "fake"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["user"]["email"] == "iamdhishan@gmail.com"
    mock_db.collection.assert_any_call("users")


def test_auth_google_rejects_non_allowlisted(client, mock_db):
    with patch("app.auth.router.verify_google_id_token", return_value=_fake_idinfo("evil@example.com")):
        r = client.post("/api/v1/auth/google", json={"id_token": "fake"})
    assert r.status_code == 403


def test_auth_google_rejects_invalid_token(client, mock_db):
    with patch("app.auth.router.verify_google_id_token", side_effect=ValueError("bad")):
        r = client.post("/api/v1/auth/google", json={"id_token": "fake"})
    assert r.status_code == 401


def test_verify_rejects_when_client_id_unconfigured(monkeypatch):
    import pytest
    from app.auth import google as g

    class _S:
        google_oauth_client_id = ""

    monkeypatch.setattr(g, "get_settings", lambda: _S())
    with pytest.raises(ValueError):
        g.verify_google_id_token("any")
