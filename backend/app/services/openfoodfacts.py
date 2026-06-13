"""OpenFoodFacts barcode lookup.

Returns an Estimation-shaped dict or None on any failure.
Never raises — all errors are swallowed so the caller gets None.
"""
import logging
import re

import requests

logger = logging.getLogger(__name__)

_BASE_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
_FIELDS = "product_name,brands,nutriments,serving_size,quantity"
_TIMEOUT = 5


def _parse_grams(serving_size: str) -> float:
    """Extract leading float from a serving_size string like '40 g' or '30g'."""
    m = re.match(r"(\d+(?:\.\d+)?)", serving_size.strip())
    if m:
        return float(m.group(1))
    return 100.0


def lookup_barcode(code: str) -> dict | None:
    """Fetch product by barcode from OpenFoodFacts.

    Returns Estimation-shaped dict or None when not found / error.
    """
    try:
        resp = requests.get(
            _BASE_URL.format(code=code),
            params={"fields": _FIELDS},
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        if data.get("status") != 1:
            return None

        product = data["product"]
        nutriments = product["nutriments"]

        # Required keys — if any are missing, return None
        cal_100 = nutriments["energy-kcal_100g"]
        prot_100 = nutriments["proteins_100g"]
        carb_100 = nutriments["carbohydrates_100g"]
        fat_100 = nutriments["fat_100g"]

        raw_serving = product.get("serving_size", "").strip()
        if raw_serving:
            grams = _parse_grams(raw_serving)
            serving_label = raw_serving
        else:
            grams = 100.0
            serving_label = "100 g"

        factor = grams / 100.0

        name = product.get("product_name", "Unknown").strip()
        brand = product.get("brands", "").strip()
        if brand:
            name = f"{name} ({brand})"

        return {
            "name": name,
            "serving": serving_label,
            "macros": {
                "calories": round(cal_100 * factor, 1),
                "protein_g": round(prot_100 * factor, 1),
                "carbs_g": round(carb_100 * factor, 1),
                "fat_g": round(fat_100 * factor, 1),
            },
            "confidence": 0.9,
            "source": "openfoodfacts",
            "code": code,
        }
    except Exception:
        logger.exception("openfoodfacts lookup failed for code=%s", code)
        return None
