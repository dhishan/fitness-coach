from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings

ALGORITHM = "HS256"


def create_access_token(user_id: str, email: str) -> str:
    s = get_settings()
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=s.jwt_expiry_hours),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, s.jwt_secret_key, algorithm=ALGORITHM)


def verify_access_token(token: str) -> dict:
    s = get_settings()
    # algorithms pinned - never trust the token header
    return jwt.decode(token, s.jwt_secret_key, algorithms=[ALGORITHM])
