import json
import logging
import time

from app.config import get_settings
from app.services import llm, usage_service

logger = logging.getLogger(__name__)

ESTIMATION_SYSTEM = (
    "You estimate calories and macros for foods. Return JSON only matching this schema: "
    '{"name": string, "serving": string, "macros": {"calories": number, "protein_g": number, '
    '"carbs_g": number, "fat_g": number}, "confidence": number between 0 and 1}. '
    "Be conservative. If unsure of portion, assume the most common serving size and mention "
    "the assumption in the name (e.g. 'Chicken bowl (1 standard serving ~350g)'). "
    "Never invent precision; round to whole numbers for calories and 1 decimal for grams."
)


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
    raw = resp.choices[0].message.content or "{}"
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
        )
        _record(user_id, "nutrition_text", resp, int((time.monotonic() - start) * 1000))
        return _parse(resp)
    except Exception as e:
        logger.exception("estimate_from_text failed")
        return {"error": f"{type(e).__name__}: {e}"}


def estimate_from_image(user_id: str, image_url: str, hint: str = "") -> dict:
    s = get_settings()
    start = time.monotonic()
    try:
        content = [
            {"type": "text", "text": hint or "Estimate macros for the food shown."},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
        resp = llm.complete(
            [
                {"role": "system", "content": ESTIMATION_SYSTEM},
                {"role": "user", "content": content},
            ],
            model=s.nutrition_model,
            metadata={
                "generation_name": "nutrition-photo",
                "trace_user_id": user_id,
                "tags": ["nutrition"],
            },
        )
        _record(user_id, "nutrition_photo", resp, int((time.monotonic() - start) * 1000))
        return _parse(resp)
    except Exception as e:
        logger.exception("estimate_from_image failed")
        return {"error": f"{type(e).__name__}: {e}"}
