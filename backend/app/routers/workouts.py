import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import WorkoutCreate, WorkoutUpdate
from app.services import workout_ai, workout_service

router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"])


@router.post("", status_code=201)
async def create_workout(body: WorkoutCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        workout_service.create_workout, user.user_id, body.model_dump()
    )


@router.get("/active")
async def active_workout(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(workout_service.get_active_workout, user.user_id)


@router.get("")
async def list_workouts(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=20, le=100),
    offset: int = 0,
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(
        workout_service.list_workouts, user.user_id, date_from, date_to, limit, offset
    )


@router.get("/{workout_id}")
async def get_workout(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(workout_service.get_workout, workout_id, user.user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    return doc


@router.put("/{workout_id}")
async def update_workout(workout_id: str, body: WorkoutUpdate,
                         user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(
        workout_service.update_workout, workout_id, user.user_id, body.model_dump()
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    return doc


@router.post("/{workout_id}/suggest-next")
async def suggest_next(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    """Return one AI-picked exercise to add next, with sets / reps / reason.

    User reviews and either Adds (which calls PUT /workouts/{id}) or cancels.
    """
    result = await asyncio.to_thread(workout_ai.suggest_next_exercise, user.user_id, workout_id)
    if result is None:
        raise HTTPException(status_code=503, detail="Could not generate a suggestion")
    return result


@router.post("/{workout_id}/finish")
async def finish_workout(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(workout_service.finish_workout, workout_id, user.user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    from app.observability import track
    track(
        "workout.finished",
        user_id=user.user_id,
        workout_id=workout_id,
        entries=len(doc.get("entries") or []),
        total_volume=doc.get("total_volume"),
    )
    return doc


@router.delete("/{workout_id}", status_code=204)
async def delete_workout(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(workout_service.delete_workout, workout_id, user.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workout not found")
    return Response(status_code=204)
