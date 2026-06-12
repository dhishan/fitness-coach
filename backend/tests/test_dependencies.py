import pytest
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_current_user_from_valid_token():
    from app.auth.dependencies import get_current_user
    from app.auth.tokens import create_access_token
    token = create_access_token(user_id="uid123", email="iamdhishan@gmail.com")
    user = await get_current_user(authorization=f"Bearer {token}")
    assert user.user_id == "uid123"
    assert user.email == "iamdhishan@gmail.com"


@pytest.mark.asyncio
async def test_current_user_rejects_missing_header():
    from app.auth.dependencies import get_current_user
    with pytest.raises(HTTPException) as e:
        await get_current_user(authorization=None)
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_current_user_rejects_bad_token():
    from app.auth.dependencies import get_current_user
    with pytest.raises(HTTPException) as e:
        await get_current_user(authorization="Bearer garbage")
    assert e.value.status_code == 401
