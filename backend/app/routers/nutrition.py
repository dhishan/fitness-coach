import asyncio

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import DayStatusUpdate, FavoriteCreate, FoodLogCreate, FoodLogUpdate, GoalsUpdate, RecipeCreate, RecipeLogRequest, RecipeUpdate
from app.security.validators import _check_food_image_url, sanitize_hint
from app.services import food_service, goals_service, ifct, nutrition_ai, off_search, openfoodfacts, recipe_service, usda

router = APIRouter(prefix="/api/v1/nutrition", tags=["nutrition"])


# ---- Food autocomplete ----

@router.get("/foods/suggest")
async def suggest_foods(
    q: str = Query(default=""),
    limit: int = Query(default=10, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(food_service.suggest_foods, user.user_id, q, limit)


# ---- Barcode lookup ----

@router.get("/barcode/{code}")
async def barcode_lookup(
    code: str = Path(pattern=r"^\d{8,14}$"),
    user: CurrentUser = Depends(get_current_user),
):
    # 1. Open Food Facts — best for European brands
    result = await asyncio.to_thread(openfoodfacts.lookup_barcode, code)
    if result is not None:
        return result
    # 2. USDA FoodData Central — best for US-packaged foods
    result = await asyncio.to_thread(usda.lookup_by_barcode, code)
    if result is not None:
        return result
    # 3. Tell the client to prompt the user to type the product name.
    raise HTTPException(
        status_code=404,
        detail={
            "error": "product_not_found",
            "message": "We don't recognize this barcode.",
            "next": "type_name",
        },
    )


# ---- AI estimation ----

@router.post("/estimate/text")
async def estimate_text(body: dict, user: CurrentUser = Depends(get_current_user)):
    text = body.get("text", "")
    if not text or not str(text).strip():
        raise HTTPException(status_code=422, detail="text is required")
    result = await asyncio.to_thread(nutrition_ai.estimate_from_text, user.user_id, str(text).strip())
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    from app.observability import track
    track("nutrition.estimate.text", user_id=user.user_id, name=result.get("name"))
    return result


@router.post("/estimate/label")
async def estimate_label(body: dict, user: CurrentUser = Depends(get_current_user)):
    """Read a Nutrition Facts label photo. Returns per-serving values verbatim.

    Same image-URL rules as /estimate/photo — must be a GCS object the user
    uploaded under their own food/ prefix.
    """
    image_url = body.get("image_url", "")
    if not image_url:
        raise HTTPException(status_code=422, detail="image_url is required")
    reason = _check_food_image_url(image_url, user.user_id)
    if reason is not None:
        raise HTTPException(status_code=422, detail=f"invalid image_url: {reason}")
    result = await asyncio.to_thread(
        nutrition_ai.estimate_from_label, user.user_id, image_url
    )
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    from app.observability import track
    track("nutrition.estimate.label", user_id=user.user_id, name=result.get("name"))
    return result


@router.get("/foods/search")
async def search_foods(
    q: str = Query(min_length=1, max_length=80),
    limit: int = Query(default=8, ge=1, le=20),
    user: CurrentUser = Depends(get_current_user),
):
    """Multi-source ingredient search: USDA + OpenFoodFacts + IFCT 2017.

    All three sources run in parallel. Results are interleaved and
    deduped by lowercase name. Total capped at `limit`.
    """
    usda_hits, off_hits, ifct_hits = await asyncio.gather(
        asyncio.to_thread(usda.search_full, q, limit),
        asyncio.to_thread(off_search.search_off, q, limit),
        asyncio.to_thread(ifct.search_ifct, q, limit),
    )

    # Tag USDA hits (off_search + ifct already set source)
    for h in usda_hits:
        h.setdefault("source", "usda")

    def _usable(hit: dict) -> bool:
        # Drop entries with no usable macros (e.g. USDA branded spice mixes
        # that report 0 for everything) — useless for tracking.
        m = hit.get("macros") or {}
        return any((m.get(k) or 0) for k in ("calories", "protein_g", "carbs_g", "fat_g"))

    # Round-robin across sources so no single source dominates the top slots.
    # IFCT first: its curated Indian dishes (e.g. "Chana Masala" for "chole")
    # are the most reliable when present; then USDA whole foods; then OFF.
    from itertools import zip_longest

    merged: list[dict] = []
    seen: set[str] = set()
    for tier in zip_longest(ifct_hits, usda_hits, off_hits):
        for hit in tier:
            if not hit or not _usable(hit):
                continue
            key = (hit.get("name", "") or "").lower()
            if key and key not in seen:
                seen.add(key)
                merged.append(hit)

    return merged[:limit]


@router.post("/estimate/photo")
async def estimate_photo(body: dict, user: CurrentUser = Depends(get_current_user)):
    image_url = body.get("image_url", "")
    if not image_url:
        raise HTTPException(status_code=422, detail="image_url is required")
    reason = _check_food_image_url(image_url, user.user_id)
    if reason is not None:
        # Reject anything not under THIS user's GCS food/ prefix. Blocks SSRF
        # (no metadata endpoints) and cross-user reads (path includes user_id).
        # Reason string is verbose intentionally so we can diagnose live.
        raise HTTPException(status_code=422, detail=f"invalid image_url: {reason}")
    hint = sanitize_hint(body.get("hint", ""))
    result = await asyncio.to_thread(
        nutrition_ai.estimate_from_image, user.user_id, image_url, hint
    )
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


# ---- Food logs ----

@router.post("/logs", status_code=201)
async def create_log(body: FoodLogCreate, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(food_service.create_log, user.user_id, body.model_dump())
    from app.observability import track
    track(
        "nutrition.log.created",
        user_id=user.user_id,
        food_name=body.name,
        source=getattr(body, "source", None),
        meal=getattr(body, "meal", None),
        calories=(body.macros or {}).get("calories") if isinstance(body.macros, dict) else getattr(body.macros, "calories", None),
    )
    return doc


@router.get("/logs")
async def list_logs(
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(food_service.list_by_date, user.user_id, date)


@router.put("/day-status")
async def set_day_status(
    body: DayStatusUpdate, user: CurrentUser = Depends(get_current_user)
):
    """Mark a date as untracked ("eating out") so totals aren't read as low intake."""
    return await asyncio.to_thread(
        food_service.set_day_incomplete, user.user_id, body.date, body.incomplete
    )


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


# ---- Recipes ----

@router.get("/recipes")
async def list_recipes(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(recipe_service.list_recipes, user.user_id)


@router.post("/recipes", status_code=201)
async def create_recipe(body: RecipeCreate, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(recipe_service.create_recipe, user.user_id, body.model_dump())
    from app.observability import track
    track("recipe.created", user_id=user.user_id, name=body.name, ingredients=len(body.ingredients or []))
    return doc


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(recipe_service.get_recipe, recipe_id, user.user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return doc


@router.put("/recipes/{recipe_id}")
async def update_recipe(
    recipe_id: str,
    body: RecipeUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    doc = await asyncio.to_thread(
        recipe_service.update_recipe,
        recipe_id,
        user.user_id,
        body.model_dump(exclude_unset=True),
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return doc


@router.delete("/recipes/{recipe_id}", status_code=204)
async def delete_recipe(recipe_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(recipe_service.delete_recipe, recipe_id, user.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return Response(status_code=204)


@router.post("/recipes/{recipe_id}/log", status_code=201)
async def log_recipe(
    recipe_id: str,
    body: RecipeLogRequest,
    user: CurrentUser = Depends(get_current_user),
):
    result = await asyncio.to_thread(
        recipe_service.log_recipe, recipe_id, user.user_id, body.model_dump()
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    from app.observability import track
    track("recipe.logged", user_id=user.user_id, recipe_id=recipe_id, servings=getattr(body, "servings_eaten", None))
    return result
