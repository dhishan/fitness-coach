from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

from app.auth.tokens import verify_access_token


@dataclass
class CurrentUser:
    user_id: str
    email: str


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = verify_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return CurrentUser(user_id=payload["sub"], email=payload["email"])
