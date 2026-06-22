"""OpenFoodFacts text search.

Returns IngredientHit-shaped dicts. Never raises.
"""
import logging
import re
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# The legacy cgi/search.pl endpoint now returns 503 for server/datacenter
# IPs, so OFF text search effectively returned nothing. Use the modern
# Search-a-licious API, which is fast (~0.5s) and ranks generic whole foods
# (e.g. "banana" -> "Banana, 89 kcal") above branded products by default.
_SEARCH_URL = "https://search.openfoodfacts.org/search"
_FIELDS = "product_name,brands,serving_size,nutriments,code"
_TIMEOUT = 8
# OFF asks every client to identify itself; anonymous requests get throttled.
_HEADERS = {"User-Agent": "FitnessTracker/1.0 (nutrition search; blueelephants.org)"}


def _parse_grams(serving_size: str) -> float:
    m = re.match(r"(\d+(?:\.\d+)?)", serving_size.strip())
    return float(m.group(1)) if m else 100.0


def _map_hit(product: dict) -> Optional[dict]:
    """Map an OFF product dict to IngredientHit shape. None when required macros missing."""
    n = product.get("nutriments") or {}
    try:
        cal_100 = float(n["energy-kcal_100g"])
        prot_100 = float(n["proteins_100g"])
        carb_100 = float(n["carbohydrates_100g"])
        fat_100 = float(n["fat_100g"])
    except (KeyError, TypeError, ValueError):
        return None

    raw_serving = (product.get("serving_size") or "").strip()
    if raw_serving:
        grams = _parse_grams(raw_serving)
        serving_label = raw_serving
    else:
        grams = 100.0
        serving_label = "100g serving"

    f = grams / 100.0

    def g2mg(key: str) -> float:
        v = n.get(key) or 0.0
        return round(float(v) * 1000, 1)

    def g2mcg(key: str) -> float:
        v = n.get(key) or 0.0
        return round(float(v) * 1_000_000, 1)

    def scaled(key: str) -> float:
        return round((n.get(key) or 0.0) * f, 1)

    # Search-a-licious returns product_name/brands as either a string or a
    # list (legacy cgi returned comma-strings). Normalize both.
    def _as_text(v) -> str:
        if isinstance(v, list):
            return ", ".join(str(x) for x in v if x).strip()
        return str(v or "").strip()

    name = _as_text(product.get("product_name")) or "Unknown"
    brand = _as_text(product.get("brands"))
    # brands often repeats the name (e.g. "Banana (Banana)") — only append when distinct
    if brand and brand.lower() not in name.lower():
        name = f"{name} ({brand})"

    return {
        "name": name,
        "serving": serving_label,
        "macros": {
            "calories": round(cal_100 * f, 1),
            "protein_g": round(prot_100 * f, 1),
            "carbs_g": round(carb_100 * f, 1),
            "fat_g": round(fat_100 * f, 1),
        },
        "micros": {
            "fiber_g": scaled("fiber_100g"),
            "sugar_g": scaled("sugars_100g"),
            # OFF stores sodium in grams per 100g; convert to mg per serving
            "sodium_mg": round((n.get("sodium_100g") or 0.0) * f * 1000, 1),
            "potassium_mg": round((n.get("potassium_100g") or 0.0) * f * 1000, 1),
            "calcium_mg": round((n.get("calcium_100g") or 0.0) * f * 1000, 1),
            "iron_mg": round((n.get("iron_100g") or 0.0) * f * 1000, 1),
            "vitamin_c_mg": round((n.get("vitamin-c_100g") or 0.0) * f * 1000, 1),
            # vitamin D in OFF is g/100g; convert to mcg
            "vitamin_d_mcg": round((n.get("vitamin-d_100g") or 0.0) * f * 1_000_000, 1),
            "saturated_fat_g": scaled("saturated-fat_100g"),
            "cholesterol_mg": round((n.get("cholesterol_100g") or 0.0) * f * 1000, 1),
        },
        "source": "off",
    }


def search_off(query: str, limit: int = 8) -> list[dict]:
    """Full-text search on OpenFoodFacts. Returns up to limit IngredientHit-shaped dicts."""
    if not query.strip():
        return []
    try:
        resp = requests.get(
            _SEARCH_URL,
            params={
                "q": query,
                # request extra: produce entries often lack per-100g macros and
                # get dropped by _map_hit, so over-fetch to still fill `limit`.
                "page_size": min(limit * 4, 40),
                "fields": _FIELDS,
            },
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return []
        body = resp.json()
        # Search-a-licious returns matches under "hits"; tolerate "products" too.
        products = body.get("hits") or body.get("products") or []
    except Exception:
        logger.exception("off search failed for %r", query)
        return []

    out: list[dict] = []
    for p in products:
        hit = _map_hit(p)
        if hit is not None:
            out.append(hit)
            if len(out) >= limit:
                break
    return out
