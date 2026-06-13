import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import BodyMetricCreate, BodyMetricUpdate
from app.services import body_service

router = APIRouter(prefix="/api/v1/body", tags=["body"])


@router.get("")
async def list_metrics(
    limit: int = Query(default=90, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(body_service.list_metrics, user.user_id, limit)


@router.post("", status_code=201)
async def create_metric(body: BodyMetricCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(body_service.create_metric, user.user_id, body.model_dump())


@router.get("/latest")
async def latest_metric(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(body_service.latest_metric, user.user_id)


@router.get("/{metric_id}")
async def get_metric(metric_id: str, user: CurrentUser = Depends(get_current_user)):
    result = await asyncio.to_thread(body_service.get_metric, user.user_id, metric_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Body metric not found")
    return result


@router.put("/{metric_id}")
async def update_metric(
    metric_id: str, body: BodyMetricUpdate, user: CurrentUser = Depends(get_current_user)
):
    result = await asyncio.to_thread(
        body_service.update_metric, user.user_id, metric_id, body.model_dump(exclude_none=True)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Body metric not found")
    return result


@router.delete("/{metric_id}", status_code=204)
async def delete_metric(metric_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(body_service.delete_metric, user.user_id, metric_id)
    if ok is None:
        raise HTTPException(status_code=404, detail="Body metric not found")
    return Response(status_code=204)
