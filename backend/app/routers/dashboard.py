import asyncio
from datetime import date

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import CurrentUser, get_current_user
from app.services import dashboard_service

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


def _ref(reference_date: str | None) -> str:
    # Client sends its LOCAL date; server falls back to UTC today only if absent.
    return reference_date or date.today().isoformat()


@router.get("/summary")
async def summary(reference_date: str | None = None,
                  user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(dashboard_service.summary, user.user_id, _ref(reference_date))


@router.get("/exercise/{exercise_id}")
async def exercise_progress(exercise_id: str, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(dashboard_service.exercise_progress, user.user_id, exercise_id)


@router.get("/muscle-split")
async def muscle_split(weeks: int = Query(default=4, ge=1, le=52),
                       reference_date: str | None = None,
                       user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        dashboard_service.muscle_split_for, user.user_id, _ref(reference_date), weeks
    )
