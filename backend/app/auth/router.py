import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth.apple import verify_apple_id_token
from app.auth.google import verify_google_id_token
from app.auth.tokens import create_access_token
from app.config import get_settings
from app.firestore import get_db

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


class GoogleAuthRequest(BaseModel):
    id_token: str


@router.post("/google")
@limiter.limit("10/minute")
async def auth_google(request: Request, body: GoogleAuthRequest):
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
@limiter.limit("10/minute")
async def auth_apple(request: Request, body: AppleAuthRequest):
    try:
        claims = await asyncio.to_thread(verify_apple_id_token, body.identity_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Apple token")

    uid = "apple_" + claims["sub"]
    display_name = body.name or ""

    # Resolve email with strict priority:
    #   1. Apple's signed claim (only present on first sign-in)
    #   2. Email previously stored for this Apple sub in Firestore
    #   3. body.email — attacker-controlled, used ONLY on first sign-in when
    #      Apple omits the claim and we have no Firestore record yet.
    claim_email = (claims.get("email") or "").lower()
    stored_email = ""
    if not claim_email:
        def _lookup():
            db = get_db()
            doc = db.collection("users").document(uid).get()
            return (doc.to_dict() or {}).get("email", "") if doc.exists else ""
        stored_email = (await asyncio.to_thread(_lookup) or "").lower()
    email = claim_email or stored_email or (body.email or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    s = get_settings()
    if email not in s.allowed_emails_list:
        raise HTTPException(status_code=403, detail="Not allowed")

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
