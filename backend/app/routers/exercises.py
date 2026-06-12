import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import Exercise, ExerciseCreate
from app.services import exercise_service

router = APIRouter(prefix="/api/v1/exercises", tags=["exercises"])


@router.get("")
async def list_exercises(muscle: str | None = None, pattern: str | None = None,
                         q: str | None = None,
                         user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        exercise_service.list_exercises, user.user_id, muscle=muscle, pattern=pattern, q=q
    )


@router.post("", status_code=201, response_model=Exercise)
async def create_exercise(body: ExerciseCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        exercise_service.create_exercise, user.user_id, body.model_dump()
    )


@router.get("/{exercise_id}/alternatives")
async def alternatives(exercise_id: str, user: CurrentUser = Depends(get_current_user)):
    result = await asyncio.to_thread(exercise_service.alternatives_for, exercise_id, user.user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return result


@router.get("/{exercise_id}/history")
async def history(exercise_id: str, limit: int = 3,
                  user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        exercise_service.history_for, exercise_id, user.user_id, limit
    )
