import asyncio

from fastapi import APIRouter, Depends

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import HealthKitBatch
from app.services import healthkit_service

router = APIRouter(prefix="/api/v1/healthkit", tags=["healthkit"])


@router.post("/sync")
async def sync(body: HealthKitBatch, user: CurrentUser = Depends(get_current_user)):
    samples = [s.model_dump() for s in body.samples]
    return await asyncio.to_thread(healthkit_service.ingest_batch, user.user_id, samples)
