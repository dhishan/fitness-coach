from unittest.mock import MagicMock, patch

import pytest


def _claims(email="iamdhishan@gmail.com", sub="001234.abcdef", aud="org.blueelephants.fitnesstracker"):
    return {
        "iss": "https://appleid.apple.com",
        "sub": sub,
        "aud": aud,
        "email": email,
        "email_verified": "true",
    }


# ---------------------------------------------------------------------------
# verify_apple_id_token
# ---------------------------------------------------------------------------


def _mock_verifier_setup():
    """Patch JWKS fetch + header read so verify_apple_id_token only exercises
    its own validation logic (iss, aud prefix), not the JWT crypto."""
    fake_key = MagicMock()
    fake_key.key = "fake-key"
    return fake_key


def test_verify_apple_success():
    from app.auth import apple

    fake_key = _mock_verifier_setup()
    with patch.object(apple, "_get_apple_jwks", return_value={"keys": [{"kid": "k1"}]}), \
         patch.object(apple, "_kid_to_key", return_value=fake_key), \
         patch("app.auth.apple.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("app.auth.apple.jwt.decode", return_value=_claims()):
        out = apple.verify_apple_id_token("tok")
    assert out["sub"] == "001234.abcdef"
    assert out["email"] == "iamdhishan@gmail.com"


def test_verify_apple_bad_issuer():
    from app.auth import apple

    fake_key = _mock_verifier_setup()
    bad = _claims()
    bad["iss"] = "https://evil.example.com"
    with patch.object(apple, "_get_apple_jwks", return_value={"keys": [{"kid": "k1"}]}), \
         patch.object(apple, "_kid_to_key", return_value=fake_key), \
         patch("app.auth.apple.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("app.auth.apple.jwt.decode", return_value=bad):
        with pytest.raises(ValueError, match="Bad issuer"):
            apple.verify_apple_id_token("tok")


def test_verify_apple_aud_no_prefix_match():
    from app.auth import apple

    fake_key = _mock_verifier_setup()
    bad = _claims(aud="com.someone.else")
    with patch.object(apple, "_get_apple_jwks", return_value={"keys": [{"kid": "k1"}]}), \
         patch.object(apple, "_kid_to_key", return_value=fake_key), \
         patch("app.auth.apple.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("app.auth.apple.jwt.decode", return_value=bad):
        with pytest.raises(ValueError, match="does not match prefix"):
            apple.verify_apple_id_token("tok")


def test_verify_apple_aud_altstore_suffix_passes():
    """AltStore rewrites bundle id; we must still accept it."""
    from app.auth import apple

    fake_key = _mock_verifier_setup()
    ok = _claims(aud="org.blueelephants.fitnesstracker.altstore.abc123")
    with patch.object(apple, "_get_apple_jwks", return_value={"keys": [{"kid": "k1"}]}), \
         patch.object(apple, "_kid_to_key", return_value=fake_key), \
         patch("app.auth.apple.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("app.auth.apple.jwt.decode", return_value=ok):
        out = apple.verify_apple_id_token("tok")
    assert out["aud"].startswith("org.blueelephants.fitnesstracker")


def test_verify_apple_missing_kid():
    from app.auth import apple

    with patch("app.auth.apple.jwt.get_unverified_header", return_value={}):
        with pytest.raises(ValueError, match="missing 'kid'"):
            apple.verify_apple_id_token("tok")


def test_verify_apple_unknown_kid_after_refresh():
    from app.auth import apple

    with patch.object(apple, "_get_apple_jwks", return_value={"keys": []}), \
         patch.object(apple, "_kid_to_key", return_value=None), \
         patch("app.auth.apple.jwt.get_unverified_header", return_value={"kid": "missing"}):
        with pytest.raises(ValueError, match="not found in JWKS"):
            apple.verify_apple_id_token("tok")


def test_verify_apple_missing_email_still_returns_claims():
    """Handler decides what to do about missing email; verifier just returns."""
    from app.auth import apple

    fake_key = _mock_verifier_setup()
    no_email = _claims()
    no_email.pop("email")
    with patch.object(apple, "_get_apple_jwks", return_value={"keys": [{"kid": "k1"}]}), \
         patch.object(apple, "_kid_to_key", return_value=fake_key), \
         patch("app.auth.apple.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("app.auth.apple.jwt.decode", return_value=no_email):
        out = apple.verify_apple_id_token("tok")
    assert "email" not in out


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def test_auth_apple_success(client, mock_db):
    with patch("app.auth.router.verify_apple_id_token", return_value=_claims()):
        r = client.post("/api/v1/auth/apple", json={"identity_token": "fake"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body
    assert body["user"]["email"] == "iamdhishan@gmail.com"
    assert body["user"]["id"] == "apple_001234.abcdef"
    mock_db.collection.assert_any_call("users")


def test_auth_apple_uses_body_email_on_first_signin(client, mock_db):
    """First sign-in: Apple omits email, no stored email in Firestore, body
    email is the only source. Body email must still be on the allowlist."""
    claims = _claims()
    claims.pop("email")
    # Firestore lookup returns no existing user doc
    mock_db.collection.return_value.document.return_value.get.return_value.exists = False
    with patch("app.auth.router.verify_apple_id_token", return_value=claims):
        r = client.post(
            "/api/v1/auth/apple",
            json={"identity_token": "fake", "email": "iamdhishan@gmail.com", "name": "Dhishan"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "iamdhishan@gmail.com"
    assert body["user"]["display_name"] == "Dhishan"


def test_auth_apple_repeat_signin_uses_stored_email_not_body(client, mock_db):
    """Repeat sign-in: Apple omits email. Body email is attacker-controlled and
    must NOT be trusted — we look up the stored email instead. If body.email
    differs from stored, the stored value wins."""
    claims = _claims()
    claims.pop("email")
    doc = mock_db.collection.return_value.document.return_value.get.return_value
    doc.exists = True
    doc.to_dict.return_value = {"email": "iamdhishan@gmail.com"}
    with patch("app.auth.router.verify_apple_id_token", return_value=claims):
        # Attacker passes an allowlisted email in body — but if our logic
        # incorrectly trusted body.email it could also accept "evil@example.com".
        # Stored email wins, so the response carries the stored value.
        r = client.post(
            "/api/v1/auth/apple",
            json={"identity_token": "fake", "email": "evil@example.com"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "iamdhishan@gmail.com"


def test_auth_apple_invalid_token(client, mock_db):
    with patch("app.auth.router.verify_apple_id_token", side_effect=ValueError("bad")):
        r = client.post("/api/v1/auth/apple", json={"identity_token": "fake"})
    assert r.status_code == 401


def test_auth_apple_rejects_non_allowlisted(client, mock_db):
    with patch("app.auth.router.verify_apple_id_token", return_value=_claims(email="evil@example.com")):
        r = client.post("/api/v1/auth/apple", json={"identity_token": "fake"})
    assert r.status_code == 403


def test_auth_apple_missing_email_400(client, mock_db):
    claims = _claims()
    claims.pop("email")
    mock_db.collection.return_value.document.return_value.get.return_value.exists = False
    with patch("app.auth.router.verify_apple_id_token", return_value=claims):
        r = client.post("/api/v1/auth/apple", json={"identity_token": "fake"})
    assert r.status_code == 400


def test_auth_apple_upserts_user_doc(client, mock_db):
    with patch("app.auth.router.verify_apple_id_token", return_value=_claims()):
        r = client.post(
            "/api/v1/auth/apple",
            json={"identity_token": "fake", "name": "Dhishan A"},
        )
    assert r.status_code == 200
    # users.document("apple_<sub>").set(...)
    mock_db.collection.assert_any_call("users")
    doc_calls = mock_db.collection.return_value.document.call_args_list
    assert any(c.args == ("apple_001234.abcdef",) for c in doc_calls)
