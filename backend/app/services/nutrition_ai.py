import json
import logging
import time
from urllib.parse import urlparse

from app.config import get_settings
from app.services import llm, usage_service
from app.services import usda

logger = logging.getLogger(__name__)

ESTIMATION_SYSTEM = (
    "You estimate calories and macros for foods. Return JSON only matching this schema: "
    '{"name": string, "serving": string, '
    '"macros": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}, '
    '"micros": {"fiber_g": number, "sugar_g": number, "sodium_mg": number, "potassium_mg": number, '
    '"calcium_mg": number, "iron_mg": number, "vitamin_c_mg": number, "vitamin_d_mcg": number, '
    '"saturated_fat_g": number, "cholesterol_mg": number}, '
    '"confidence": number between 0 and 1}. '
    "Be conservative. If unsure of portion, assume the most common serving size and mention "
    "the assumption in the name (e.g. 'Chicken bowl (1 standard serving ~350g)'). "
    "Never invent precision; round to whole numbers for calories and 1 decimal for grams. "
    "Estimate micros as best-effort; default each micro field to 0 if unknown."
)

def _signed_get(image_url: str) -> str:
    """Convert a private storage.googleapis.com object URL to a short-lived
    signed GET URL so OpenAI can fetch it. Pass other URLs through untouched."""
    try:
        u = urlparse(image_url)
        if u.netloc != "storage.googleapis.com":
            return image_url
        # path is /<bucket>/<object...>
        parts = u.path.lstrip("/").split("/", 1)
        if len(parts) != 2:
            return image_url
        bucket, object_name = parts
        from app.routers.uploads import sign_get_url
        return sign_get_url(bucket, object_name, minutes=10)
    except Exception:
        logger.exception("failed to sign GET url, passing through")
        return image_url


_MICRO_KEYS = (
    "fiber_g", "sugar_g", "sodium_mg", "potassium_mg", "calcium_mg",
    "iron_mg", "vitamin_c_mg", "vitamin_d_mcg", "saturated_fat_g", "cholesterol_mg",
)


def _enrich(parsed: dict) -> dict:
    """Attempt USDA enrichment; merge into parsed in-place. Always returns parsed."""
    name = parsed.get("name", "")
    enrichment = None
    if name:
        try:
            enrichment = usda.enrich_estimation(name)
        except Exception:
            logger.exception("usda.enrich_estimation failed for %r", name)

    if enrichment is not None:
        parsed["macros"] = enrichment["macros"]
        parsed["micros"] = enrichment.get("micros", {k: 0.0 for k in _MICRO_KEYS})
        parsed["micros_source"] = "usda"
        parsed["usda_fdc_id"] = enrichment.get("usda_fdc_id")
        confidence = parsed.get("confidence", 0.8)
        parsed["confidence"] = min(0.95, (confidence or 0) + 0.1)
    else:
        # Use AI micros if provided, default missing keys to 0
        ai_micros = parsed.get("micros") or {}
        parsed["micros"] = {k: float(ai_micros.get(k, 0) or 0) for k in _MICRO_KEYS}
        parsed["micros_source"] = None
        parsed.setdefault("usda_fdc_id", None)

    return parsed


def _record(user_id: str, source: str, resp, duration_ms: int):
    usage = getattr(resp, "usage", None)
    usage_service.record_usage(
        user_id=user_id,
        source=source,
        model=get_settings().nutrition_model,
        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        duration_ms=duration_ms,
    )


def _parse(resp) -> dict:
    raw = (resp.choices[0].message.content or "{}").strip()
    # Models sometimes wrap JSON in ```json ... ``` fences despite instructions.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    # Or prefix with prose — grab the first {...} block as a fallback.
    if not raw.startswith("{"):
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end > start:
            raw = raw[start : end + 1]
    return json.loads(raw)


def estimate_from_text(user_id: str, text: str) -> dict:
    s = get_settings()
    start = time.monotonic()
    try:
        resp = llm.complete(
            [
                {"role": "system", "content": ESTIMATION_SYSTEM},
                {"role": "user", "content": text},
            ],
            model=s.nutrition_model,
            metadata={
                "generation_name": "nutrition-text",
                "trace_user_id": user_id,
                "tags": ["nutrition"],
            },
            response_format={"type": "json_object"},
        )
        _record(user_id, "nutrition_text", resp, int((time.monotonic() - start) * 1000))
        return _enrich(_parse(resp))
    except Exception as e:
        logger.exception("estimate_from_text failed")
        return {"error": f"{type(e).__name__}: {e}"}


LABEL_SYSTEM = (
    "You read a photo of a packaged-food NUTRITION FACTS label and extract the "
    "per-serving values literally. Return JSON only matching this schema: "
    '{"name": string, "serving": string, '
    '"macros": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}, '
    '"micros": {"fiber_g": number, "sugar_g": number, "sodium_mg": number, "potassium_mg": number, '
    '"calcium_mg": number, "iron_mg": number, "vitamin_c_mg": number, "vitamin_d_mcg": number, '
    '"saturated_fat_g": number, "cholesterol_mg": number}, '
    '"confidence": number between 0 and 1}. '
    "Read PER SERVING values exactly as printed. Do NOT scale, do NOT average, "
    "do NOT estimate portion. If the product name/brand is visible elsewhere on the package, "
    "set name to '<Product> (<Brand>)'. Set serving to the label's serving size including the "
    "unit + gram weight in parentheses if shown, e.g. '1 scoop (31g)'. Use 0 for any field "
    "you cannot read clearly. confidence: 0.95 if every required value is clearly visible, "
    "0.7 if some fields blurry, 0.4 if label is partially hidden."
)


def estimate_from_label(user_id: str, image_url: str) -> dict:
    """Read a Nutrition Facts label and return per-serving values verbatim.
    No USDA enrichment — the label IS the truth."""
    s = get_settings()
    start = time.monotonic()
    try:
        fetch_url = _signed_get(image_url)
        content = [
            {"type": "text", "text": "Read the nutrition facts label and return per-serving values."},
            {"type": "image_url", "image_url": {"url": fetch_url}},
        ]
        resp = llm.complete(
            [
                {"role": "system", "content": LABEL_SYSTEM},
                {"role": "user", "content": content},
            ],
            model=s.nutrition_model,
            metadata={
                "generation_name": "nutrition-label",
                "trace_user_id": user_id,
                "tags": ["nutrition", "label"],
            },
            response_format={"type": "json_object"},
        )
        _record(user_id, "nutrition_label", resp, int((time.monotonic() - start) * 1000))
        parsed = _parse(resp)
        # Don't enrich from USDA — the label values are authoritative.
        macros = parsed.get("macros") or {}
        for k in ("calories", "protein_g", "carbs_g", "fat_g"):
            macros[k] = float(macros.get(k, 0) or 0)
        parsed["macros"] = macros
        ai_micros = parsed.get("micros") or {}
        parsed["micros"] = {k: float(ai_micros.get(k, 0) or 0) for k in _MICRO_KEYS}
        parsed["micros_source"] = "label"
        return parsed
    except Exception as e:
        logger.exception("estimate_from_label failed")
        return {"error": f"{type(e).__name__}: {e}"}


VISION_SYSTEM = (
    "You analyze a food photo and return JSON only. FIRST decide whether the image is a "
    "packaged-food NUTRITION FACTS label or a photo of prepared/served food. "
    "Schema: "
    '{"is_label": boolean, "name": string, "serving": string, '
    '"macros": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}, '
    '"micros": {"fiber_g": number, "sugar_g": number, "sodium_mg": number, "potassium_mg": number, '
    '"calcium_mg": number, "iron_mg": number, "vitamin_c_mg": number, "vitamin_d_mcg": number, '
    '"saturated_fat_g": number, "cholesterol_mg": number}, '
    '"confidence": number between 0 and 1}. '
    "If it IS a Nutrition Facts label: set is_label=true and read the PER-SERVING values EXACTLY "
    "as printed — do NOT estimate or rescale. Set serving to the label's serving size including "
    "the gram weight if shown (e.g. '1 piece (35g)'). If the product/brand is visible, set name to "
    "'<Product> (<Brand>)'. Use 0 for any value not printed on the label. "
    "If it is PREPARED FOOD (not a label): set is_label=false and estimate macros plus best-effort "
    "micros; assume the most common serving and note it in the name "
    "(e.g. 'Chicken bowl (1 standard serving ~350g)'); default unknown micros to 0. "
    "Round calories to whole numbers and grams to 1 decimal. Never invent precision."
)


def estimate_from_image(user_id: str, image_url: str, hint: str = "") -> dict:
    """Estimate from a food photo. Auto-detects a Nutrition Facts label vs a
    prepared-food photo: a label is read verbatim and treated as authoritative
    (no USDA enrichment); prepared food is estimated and USDA-enriched."""
    s = get_settings()
    start = time.monotonic()
    try:
        fetch_url = _signed_get(image_url)
        instruction = (
            "Determine if this is a packaged nutrition-facts label or prepared food, "
            "then return the values per the schema."
        )
        if hint:
            instruction = f"{hint}\n\n{instruction}"
        content = [
            {"type": "text", "text": instruction},
            {"type": "image_url", "image_url": {"url": fetch_url}},
        ]
        resp = llm.complete(
            [
                {"role": "system", "content": VISION_SYSTEM},
                {"role": "user", "content": content},
            ],
            model=s.nutrition_model,
            metadata={
                "generation_name": "nutrition-photo",
                "trace_user_id": user_id,
                "tags": ["nutrition"],
            },
            response_format={"type": "json_object"},
        )
        _record(user_id, "nutrition_photo", resp, int((time.monotonic() - start) * 1000))
        parsed = _parse(resp)

        if parsed.get("is_label"):
            # The label is the source of truth — take its values verbatim and
            # skip USDA enrichment (which would override the printed numbers).
            macros = parsed.get("macros") or {}
            parsed["macros"] = {
                k: float(macros.get(k, 0) or 0)
                for k in ("calories", "protein_g", "carbs_g", "fat_g")
            }
            ai_micros = parsed.get("micros") or {}
            parsed["micros"] = {k: float(ai_micros.get(k, 0) or 0) for k in _MICRO_KEYS}
            parsed["micros_source"] = "label"
            parsed.setdefault("usda_fdc_id", None)
            return parsed

        # Prepared food — estimate + USDA enrichment.
        return _enrich(parsed)
    except Exception as e:
        logger.exception("estimate_from_image failed")
        return {"error": f"{type(e).__name__}: {e}"}
