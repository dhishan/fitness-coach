import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth.apple import verify_apple_id_token
from app.auth.google import verify_google_id_token
from app.auth.tokens import create_access_token
from app.config import get_settings
from app.firestore import get_db

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class GoogleAuthRequest(BaseModel):
    id_token: str


@router.post("/google")
async def auth_google(body: GoogleAuthRequest):
    try:
        idinfo = await asyncio.to_thread(verify_google_id_token, body.id_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = (idinfo.get("email") or "").lower()
    s = get_settings()
    if email not in s.allowed_emails_list:
        raise HTTPException(status_code=403, detail="Not allowed")

    uid = idinfo["sub"]

    def _upsert():
        db = get_db()
        ref = db.collection("users").document(uid)
        ref.set(
            {
                "email": email,
                "display_name": idinfo.get("name", ""),
                "preferred_units": "kg",
                "updated_at": datetime.now(timezone.utc),
            },
            merge=True,
        )

    await asyncio.to_thread(_upsert)

    return {
        "access_token": create_access_token(user_id=uid, email=email),
        "token_type": "bearer",
        "user": {"id": uid, "email": email, "display_name": idinfo.get("name", "")},
    }


class AppleAuthRequest(BaseModel):
    identity_token: str
    name: str | None = None
    email: str | None = None


@router.post("/apple")
async def auth_apple(body: AppleAuthRequest):
    try:
        claims = await asyncio.to_thread(verify_apple_id_token, body.identity_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Apple token")

    email = (claims.get("email") or body.email or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    s = get_settings()
    if email not in s.allowed_emails_list:
        raise HTTPException(status_code=403, detail="Not allowed")

    uid = "apple_" + claims["sub"]
    display_name = body.name or ""

    def _upsert():
        db = get_db()
        ref = db.collection("users").document(uid)
        ref.set(
            {
                "email": email,
                "display_name": display_name,
                "preferred_units": "kg",
                "updated_at": datetime.now(timezone.utc),
            },
            merge=True,
        )

    await asyncio.to_thread(_upsert)

    return {
        "access_token": create_access_token(user_id=uid, email=email),
        "token_type": "bearer",
        "user": {"id": uid, "email": email, "display_name": display_name},
    }
