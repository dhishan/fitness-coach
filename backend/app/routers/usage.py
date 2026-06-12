import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth.dependencies import CurrentUser, get_current_user
from app.services import usage_service

router = APIRouter(prefix="/api/v1/usage", tags=["usage"])


@router.get("/summary")
async def summary(month: str | None = None, user: CurrentUser = Depends(get_current_user)):
    m = month or datetime.now(timezone.utc).strftime("%Y-%m")
    return await asyncio.to_thread(usage_service.monthly_summary, user.user_id, m)
