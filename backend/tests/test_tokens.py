import pytest


def test_create_and_verify_roundtrip():
    from app.auth.tokens import create_access_token, verify_access_token
    token = create_access_token(user_id="uid123", email="iamdhishan@gmail.com")
    payload = verify_access_token(token)
    assert payload["sub"] == "uid123"
    assert payload["email"] == "iamdhishan@gmail.com"


def test_verify_rejects_garbage():
    from app.auth.tokens import verify_access_token
    with pytest.raises(Exception):
        verify_access_token("not-a-token")
