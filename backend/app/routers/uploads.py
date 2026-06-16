import asyncio
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import CurrentUser, get_current_user
from app.config import get_settings
from app.security.validators import ALLOWED_IMAGE_CONTENT_TYPES

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])


def _sign_url(bucket: str, object_name: str, content_type: str) -> str:
    """V4 signed PUT URL using the Cloud Run runtime SA via IAM Credentials API."""
    from google.auth import default
    from google.auth.transport.requests import Request
    from google.cloud import storage

    credentials, _ = default()
    credentials.refresh(Request())

    sa_email = getattr(credentials, "service_account_email", None)
    if not sa_email:
        raise RuntimeError("Could not determine service account email for signing")

    client = storage.Client(credentials=credentials)
    blob = client.bucket(bucket).blob(object_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=5),
        method="PUT",
        content_type=content_type,
        service_account_email=sa_email,
        access_token=credentials.token,
    )


@router.post("/sign-food-photo")
async def sign_food_photo(
    content_type: str = "image/jpeg",
    user: CurrentUser = Depends(get_current_user),
):
    if content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="unsupported content type")
    s = get_settings()
    if not s.uploads_bucket:
        raise HTTPException(status_code=503, detail="uploads not configured")
    object_name = f"food/{user.user_id}/{uuid.uuid4().hex}.jpg"
    url = await asyncio.to_thread(_sign_url, s.uploads_bucket, object_name, content_type)
    return {
        "upload_url": url,
        "gs_url": f"gs://{s.uploads_bucket}/{object_name}",
        "public_url": f"https://storage.googleapis.com/{s.uploads_bucket}/{object_name}",
        "content_type": content_type,
    }
