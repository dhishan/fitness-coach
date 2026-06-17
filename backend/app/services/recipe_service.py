"""Recipe service.

Recipes are user-owned Firestore docs. The macros + micros stored on the
parent doc are derived from the ingredients list — never trust client-supplied
totals. Recompute on every write so old recipes auto-update if ingredients
change.

Logging a recipe is just: per_serving_macros × servings_eaten → write a
FoodLog. The original recipe stays the source of truth; the food log is a
point-in-time copy (so editing the recipe later doesn't rewrite history).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore

from app.firestore import get_db
from app.services import food_service

# ---------------------------------------------------------------------------
# Pure math — fully unit testable, no Firestore.
# ---------------------------------------------------------------------------

_MACRO_KEYS = ("calories", "protein_g", "carbs_g", "fat_g")
_MICRO_KEYS = (
    "fiber_g", "sugar_g", "sodium_mg", "potassium_mg", "calcium_mg",
    "iron_mg", "vitamin_c_mg", "vitamin_d_mcg", "saturated_fat_g", "cholesterol_mg",
)


def compute_totals(ingredients: list[dict], yields_servings: float) -> tuple[dict, dict, dict, dict]:
    """Return (totals_macros, totals_micros, per_serving_macros, per_serving_micros).

    Each ingredient contributes `per_serving_value * servings_used` for every
    nutrient. Totals are summed across ingredients. Per-serving (recipe) is
    totals / yields_servings.

    Yields_servings <= 0 raises ValueError.
    """
    if yields_servings <= 0:
        raise ValueError("yields_servings must be > 0")

    totals_macros = {k: 0.0 for k in _MACRO_KEYS}
    totals_micros = {k: 0.0 for k in _MICRO_KEYS}

    for ing in ingredients:
        servings_used = float(ing.get("servings_used") or 0)
        if servings_used <= 0:
            continue
        for k in _MACRO_KEYS:
            v = float(ing.get(f"{k}_per_serving") or 0)
            totals_macros[k] += v * servings_used
        for k in _MICRO_KEYS:
            v = float(ing.get(f"{k}_per_serving") or 0)
            totals_micros[k] += v * servings_used

    per_serving_macros = {k: _round(totals_macros[k] / yields_servings, k) for k in _MACRO_KEYS}
    per_serving_micros = {k: _round(totals_micros[k] / yields_servings, k) for k in _MICRO_KEYS}
    totals_macros = {k: _round(totals_macros[k], k) for k in _MACRO_KEYS}
    totals_micros = {k: _round(totals_micros[k], k) for k in _MICRO_KEYS}
    return totals_macros, totals_micros, per_serving_macros, per_serving_micros


def _round(v: float, key: str) -> float:
    # Calories whole, macros 1dp, micros 1dp.
    if key == "calories":
        return round(v)
    return round(v, 1)


def scale_macros(per_serving: dict, servings_eaten: float) -> dict:
    """Multiply a per-serving macros dict by servings, preserving rounding."""
    return {k: _round(per_serving.get(k, 0) * servings_eaten, k) for k in _MACRO_KEYS}


def scale_micros(per_serving: dict, servings_eaten: float) -> dict:
    return {k: _round(per_serving.get(k, 0) * servings_eaten, k) for k in _MICRO_KEYS}


# ---------------------------------------------------------------------------
# Firestore I/O
# ---------------------------------------------------------------------------


def _doc_to_recipe(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


def list_recipes(user_id: str) -> list[dict]:
    db = get_db()
    query = db.collection("recipes").where(filter=firestore.FieldFilter("user_id", "==", user_id))
    docs = [_doc_to_recipe(d) for d in query.stream()]
    docs.sort(key=lambda d: d.get("name", "").lower())
    return docs


def get_recipe(recipe_id: str, user_id: str) -> dict | None:
    db = get_db()
    snap = db.collection("recipes").document(recipe_id).get()
    if not snap.exists:
        return None
    doc = _doc_to_recipe(snap)
    if doc.get("user_id") != user_id:
        return None
    return doc


def _build_recipe_doc(user_id: str, payload: dict) -> dict:
    ingredients = payload.get("ingredients") or []
    yields = float(payload.get("yields_servings") or 1.0)
    if yields <= 0:
        raise ValueError("yields_servings must be > 0")
    totals_m, totals_u, per_m, per_u = compute_totals(ingredients, yields)
    return {
        "user_id": user_id,
        "name": payload["name"],
        "yields_servings": yields,
        "ingredients": ingredients,
        "notes": payload.get("notes") or "",
        "totals_macros": totals_m,
        "totals_micros": totals_u,
        "per_serving_macros": per_m,
        "per_serving_micros": per_u,
        "updated_at": datetime.now(timezone.utc),
    }


def create_recipe(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc = _build_recipe_doc(user_id, payload)
    doc["created_at"] = datetime.now(timezone.utc)
    ref = db.collection("recipes").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def update_recipe(recipe_id: str, user_id: str, payload: dict) -> dict | None:
    existing = get_recipe(recipe_id, user_id)
    if existing is None:
        return None
    merged = {
        "name": payload.get("name") if payload.get("name") is not None else existing["name"],
        "yields_servings": payload.get("yields_servings") if payload.get("yields_servings") is not None else existing.get("yields_servings", 1.0),
        "ingredients": payload.get("ingredients") if payload.get("ingredients") is not None else existing.get("ingredients", []),
        "notes": payload.get("notes") if payload.get("notes") is not None else existing.get("notes", ""),
    }
    doc = _build_recipe_doc(user_id, merged)
    get_db().collection("recipes").document(recipe_id).update(doc)
    return {**doc, "id": recipe_id, "created_at": existing.get("created_at")}


def delete_recipe(recipe_id: str, user_id: str) -> bool:
    existing = get_recipe(recipe_id, user_id)
    if existing is None:
        return False
    get_db().collection("recipes").document(recipe_id).delete()
    return True


def log_recipe(recipe_id: str, user_id: str, payload: dict) -> dict | None:
    """Create a FoodLog from a recipe + servings_eaten. Returns the food log."""
    recipe = get_recipe(recipe_id, user_id)
    if recipe is None:
        return None
    servings_eaten = float(payload["servings_eaten"])
    per_m = recipe.get("per_serving_macros") or {}
    per_u = recipe.get("per_serving_micros") or {}
    scaled_macros = scale_macros(per_m, servings_eaten)
    scaled_micros = scale_micros(per_u, servings_eaten)

    log_payload = {
        "date": payload["date"],
        "name": recipe["name"],
        "serving": f"{_fmt_servings(servings_eaten)} serving"
                   + ("s" if servings_eaten != 1 else ""),
        "macros": scaled_macros,
        "micros": scaled_micros,
        "source": "manual",
        "notes": payload.get("notes") or "",
        "meal_type": payload.get("meal_type"),
        "logged_at": payload.get("logged_at"),
        "recipe_id": recipe_id,
        "servings_eaten": servings_eaten,
    }
    return food_service.create_log(user_id, log_payload)


def _fmt_servings(s: float) -> str:
    return str(int(s)) if s == int(s) else str(s)
