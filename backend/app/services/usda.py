import logging
from typing import Any

import requests

from app.config import get_settings
from app.firestore import get_db

logger = logging.getLogger(__name__)

USDA_BASE = "https://api.nal.usda.gov/fdc/v1"
TIMEOUT_S = 6

# Prefer generic whole-food datasets over branded packaged products.
_DATA_TYPE_RANK = {"Foundation": 0, "SR Legacy": 1, "Survey (FNDDS)": 2, "Branded": 3}

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
                # Over-fetch a candidate pool so whole-food entries (which USDA
                # often ranks below branded) are present to be re-ranked, then
                # we slice to `limit` after tiering.
                "pageSize": max(limit, 25),
                "dataType": "Foundation,SR Legacy,Branded",
            },
            timeout=TIMEOUT_S,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        out = []
        for f in (data.get("foods") or []):
            out.append({
                "fdc_id": f.get("fdcId"),
                "description": f.get("description", ""),
                "brand_owner": f.get("brandOwner"),
                "score": f.get("score", 0),
                "data_type": f.get("dataType"),
            })
        # Rank generic whole foods ahead of branded products so a plain query
        # like "banana" surfaces "Bananas, raw" (89 kcal) over branded candy.
        # Stable sort preserves USDA's relevance order within each tier.
        out.sort(key=lambda h: _DATA_TYPE_RANK.get(h.get("data_type") or "", 3))
        return out[:limit]
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
    energy_alt: dict[int, float] = {}  # Atwater / kJ energy fallbacks for Foundation foods
    for n in data.get("foodNutrients") or []:
        nid = (n.get("nutrient") or {}).get("id") or n.get("nutrientId")
        amount = n.get("amount", 0) or 0
        if nid in NUTRIENT_MAP:
            field, kind = NUTRIENT_MAP[nid]
            target = macros if kind == "macro" else micros
            target[field] = float(amount)
        elif nid in (2047, 2048, 1062):
            energy_alt[nid] = float(amount)

    # Foundation foods often omit nutrient 1008 (Energy kcal); fall back to
    # Atwater kcal (2047/2048) or convert kJ (1062 -> kcal) so calories != 0.
    if not macros["calories"]:
        if energy_alt.get(2047):
            macros["calories"] = energy_alt[2047]
        elif energy_alt.get(2048):
            macros["calories"] = energy_alt[2048]
        elif energy_alt.get(1062):
            macros["calories"] = round(energy_alt[1062] / 4.184, 1)

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


def search_full(query: str, limit: int = 8) -> list[dict]:
    """Search USDA and return each hit with full per-serving nutrients.

    Each item is the same Estimation-shaped dict get_nutrients() returns
    (name, serving, macros, micros, usda_fdc_id). Used to populate the
    recipe ingredient picker.
    """
    hits = search(query, limit=limit)
    out: list[dict] = []
    for h in hits:
        nutrients = get_nutrients(h.get("fdc_id"))
        if nutrients is None:
            continue
        # Branded foods often have brandOwner not yet in nutrients name
        name = nutrients.get("name", "")
        brand = (h.get("brand_owner") or "").strip()
        if brand and brand.lower() not in name.lower():
            name = f"{name} ({brand})"
        out.append({
            **nutrients,
            "name": name,
            "data_type": h.get("data_type"),
        })
    return out


def lookup_by_barcode(code: str) -> dict | None:
    """Search USDA Branded foods for a UPC/GTIN match. None on miss.

    Returned shape matches openfoodfacts.lookup_barcode (Estimation-shaped)
    so the router can use either result interchangeably.
    """
    if not code or not code.strip():
        return None
    key = _key()
    if not key:
        return None
    # USDA's search endpoint matches GTIN/UPC when the query is the bare digits
    # and dataType is Branded.
    try:
        r = requests.get(
            f"{USDA_BASE}/foods/search",
            params={
                "api_key": key,
                "query": code,
                "pageSize": 5,
                "dataType": "Branded",
            },
            timeout=TIMEOUT_S,
        )
        if r.status_code != 200:
            return None
        foods = (r.json().get("foods") or [])
    except Exception:
        logger.exception("usda barcode search failed for code=%s", code)
        return None

    # Prefer rows whose gtinUpc actually equals the scanned code.
    hit = next((f for f in foods if (f.get("gtinUpc") or "").lstrip("0") == code.lstrip("0")), None)
    if hit is None and foods:
        hit = foods[0]
    if hit is None:
        return None

    nutrients = get_nutrients(hit.get("fdcId"))
    if nutrients is None:
        return None

    # Brand the name if we have one — matches OFF's "Name (Brand)" formatting.
    name = nutrients.get("name", "Unknown")
    brand = (hit.get("brandOwner") or "").strip()
    if brand and brand.lower() not in name.lower():
        name = f"{name} ({brand})"

    return {
        "name": name,
        "serving": nutrients.get("serving", "100 g"),
        "macros": nutrients.get("macros", {}),
        "micros": nutrients.get("micros", {}),
        "confidence": 0.85,
        "source": "usda",
        "code": code,
        "usda_fdc_id": nutrients.get("usda_fdc_id"),
    }


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
