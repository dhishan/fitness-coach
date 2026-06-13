import logging
from typing import Any

import requests

from app.config import get_settings
from app.firestore import get_db

logger = logging.getLogger(__name__)

USDA_BASE = "https://api.nal.usda.gov/fdc/v1"
TIMEOUT_S = 6

# USDA nutrient id -> (our_field, kind)
NUTRIENT_MAP = {
    1003: ("protein_g", "macro"),
    1004: ("fat_g", "macro"),
    1005: ("carbs_g", "macro"),
    1008: ("calories", "macro"),
    1079: ("fiber_g", "micro"),
    2000: ("sugar_g", "micro"),
    1093: ("sodium_mg", "micro"),
    1092: ("potassium_mg", "micro"),
    1087: ("calcium_mg", "micro"),
    1089: ("iron_mg", "micro"),
    1162: ("vitamin_c_mg", "micro"),
    1114: ("vitamin_d_mcg", "micro"),
    1258: ("saturated_fat_g", "micro"),
    1253: ("cholesterol_mg", "micro"),
}


def _key() -> str | None:
    k = get_settings().usda_api_key
    return k or None


def search(query: str, limit: int = 5) -> list[dict]:
    """Return top USDA matches: [{fdc_id, description, brand_owner, score, data_type}].
    Empty list on any failure (key missing, http error, parse error)."""
    key = _key()
    if not key or not query.strip():
        return []
    try:
        r = requests.get(
            f"{USDA_BASE}/foods/search",
            params={
                "api_key": key,
                "query": query,
                "pageSize": min(limit, 20),
                "dataType": "Foundation,SR Legacy,Branded",
            },
            timeout=TIMEOUT_S,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        out = []
        for f in (data.get("foods") or [])[:limit]:
            out.append({
                "fdc_id": f.get("fdcId"),
                "description": f.get("description", ""),
                "brand_owner": f.get("brandOwner"),
                "score": f.get("score", 0),
                "data_type": f.get("dataType"),
            })
        return out
    except Exception:
        logger.exception("usda search failed for %r", query)
        return []


def get_nutrients(fdc_id: int) -> dict | None:
    """Return {macros, micros, name, serving} or None. Cached in Firestore."""
    if not fdc_id:
        return None
    db = get_db()
    cache_ref = db.collection("usda_cache").document(str(fdc_id))
    try:
        snap = cache_ref.get()
        if snap.exists:
            return snap.to_dict()
    except Exception:
        logger.exception("usda cache read failed")

    key = _key()
    if not key:
        return None
    try:
        r = requests.get(
            f"{USDA_BASE}/food/{fdc_id}",
            params={"api_key": key},
            timeout=TIMEOUT_S,
        )
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception:
        logger.exception("usda fetch failed for fdc_id=%s", fdc_id)
        return None

    macros: dict[str, float] = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    micros: dict[str, float] = {
        k: 0.0 for k in (
            "fiber_g", "sugar_g", "sodium_mg", "potassium_mg", "calcium_mg",
            "iron_mg", "vitamin_c_mg", "vitamin_d_mcg", "saturated_fat_g", "cholesterol_mg",
        )
    }
    for n in data.get("foodNutrients") or []:
        nid = (n.get("nutrient") or {}).get("id") or n.get("nutrientId")
        amount = n.get("amount", 0) or 0
        if nid in NUTRIENT_MAP:
            field, kind = NUTRIENT_MAP[nid]
            target = macros if kind == "macro" else micros
            target[field] = float(amount)

    name = data.get("description", "")
    if data.get("brandOwner"):
        name = f"{name} ({data['brandOwner']})"
    serving = "100 g"
    if data.get("servingSize") and data.get("servingSizeUnit"):
        serving = f"{data['servingSize']} {data['servingSizeUnit']}"

    out = {
        "name": name,
        "serving": serving,
        "macros": macros,
        "micros": micros,
        "usda_fdc_id": fdc_id,
    }
    try:
        cache_ref.set(out)
    except Exception:
        logger.exception("usda cache write failed")
    return out


def enrich_estimation(name_query: str) -> dict | None:
    """Search USDA for name_query; if a confident hit exists, return its nutrient dict.
    None when no key, no hit, or below confidence threshold."""
    hits = search(name_query, limit=3)
    if not hits:
        return None
    top = hits[0]
    # Score threshold: Foundation/SR Legacy require >= 500; Branded >= 200
    threshold = 200 if top.get("data_type") == "Branded" else 500
    if (top.get("score") or 0) < threshold:
        return None
    return get_nutrients(top["fdc_id"])
