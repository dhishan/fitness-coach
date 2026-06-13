import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import FavoriteCreate, FoodLogCreate, FoodLogUpdate, GoalsUpdate
from app.services import food_service, goals_service, nutrition_ai, openfoodfacts

router = APIRouter(prefix="/api/v1/nutrition", tags=["nutrition"])


# ---- Barcode lookup ----

@router.get("/barcode/{code}")
async def barcode_lookup(code: str, user: CurrentUser = Depends(get_current_user)):
    result = await asyncio.to_thread(openfoodfacts.lookup_barcode, code)
    if result is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return result


# ---- AI estimation ----

@router.post("/estimate/text")
async def estimate_text(body: dict, user: CurrentUser = Depends(get_current_user)):
    text = body.get("text", "")
    if not text or not str(text).strip():
        raise HTTPException(status_code=422, detail="text is required")
    result = await asyncio.to_thread(nutrition_ai.estimate_from_text, user.user_id, str(text).strip())
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@router.post("/estimate/photo")
async def estimate_photo(body: dict, user: CurrentUser = Depends(get_current_user)):
    image_url = body.get("image_url", "")
    if not image_url:
        raise HTTPException(status_code=422, detail="image_url is required")
    hint = body.get("hint", "")
    result = await asyncio.to_thread(
        nutrition_ai.estimate_from_image, user.user_id, image_url, hint
    )
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


# ---- Food logs ----

@router.post("/logs", status_code=201)
async def create_log(body: FoodLogCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(food_service.create_log, user.user_id, body.model_dump())


@router.get("/logs")
async def list_logs(
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(food_service.list_by_date, user.user_id, date)


@router.put("/logs/{log_id}")
async def update_log(
    log_id: str, body: FoodLogUpdate, user: CurrentUser = Depends(get_current_user)
):
    result = await asyncio.to_thread(
        food_service.update_log, user.user_id, log_id, body.model_dump(exclude_none=True)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Food log not found")
    return result


@router.delete("/logs/{log_id}", status_code=204)
async def delete_log(log_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(food_service.delete_log, user.user_id, log_id)
    if ok is None:
        raise HTTPException(status_code=404, detail="Food log not found")
    return Response(status_code=204)


# ---- Favorites ----

@router.get("/favorites")
async def list_favorites(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(food_service.list_favorites, user.user_id)


@router.post("/favorites", status_code=201)
async def create_favorite(body: FavoriteCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(food_service.create_favorite, user.user_id, body.model_dump())


@router.delete("/favorites/{fav_id}", status_code=204)
async def delete_favorite(fav_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(food_service.delete_favorite, user.user_id, fav_id)
    if ok is None:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return Response(status_code=204)


@router.post("/favorites/{fav_id}/log", status_code=201)
async def log_from_favorite(
    fav_id: str,
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user: CurrentUser = Depends(get_current_user),
):
    result = await asyncio.to_thread(food_service.log_from_favorite, user.user_id, fav_id, date)
    if result is None:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return result


# ---- Goals ----

@router.get("/goals")
async def get_goals(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(goals_service.get_goals, user.user_id)


@router.put("/goals")
async def set_goals(body: GoalsUpdate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(goals_service.set_goals, user.user_id, body.model_dump())


@router.post("/goals/suggest")
async def suggest_goals(body: dict, user: CurrentUser = Depends(get_current_user)):
    bodyweight_kg = body.get("bodyweight_kg")
    goal_text = body.get("goal_text", "")
    result = await asyncio.to_thread(
        goals_service.suggest_goals, user.user_id, bodyweight_kg, goal_text
    )
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result
