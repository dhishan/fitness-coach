import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import CardioLogCreate, CardioLogUpdate
from app.services import cardio_service

router = APIRouter(prefix="/api/v1/cardio", tags=["cardio"])


@router.get("")
async def list_logs(
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(
        cardio_service.list_logs, user.user_id, date_from, date_to, limit, offset
    )


@router.post("", status_code=201)
async def create_log(body: CardioLogCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(cardio_service.create_log, user.user_id, body.model_dump())


@router.get("/{log_id}")
async def get_log(log_id: str, user: CurrentUser = Depends(get_current_user)):
    result = await asyncio.to_thread(cardio_service.get_log, user.user_id, log_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Cardio log not found")
    return result


@router.put("/{log_id}")
async def update_log(
    log_id: str, body: CardioLogUpdate, user: CurrentUser = Depends(get_current_user)
):
    result = await asyncio.to_thread(
        cardio_service.update_log, user.user_id, log_id, body.model_dump(exclude_none=True)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Cardio log not found")
    return result


@router.delete("/{log_id}", status_code=204)
async def delete_log(log_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(cardio_service.delete_log, user.user_id, log_id)
    if ok is None:
        raise HTTPException(status_code=404, detail="Cardio log not found")
    return Response(status_code=204)
