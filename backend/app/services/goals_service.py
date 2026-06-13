"""Daily nutrition goals: get / set / AI suggest.

Goals are stored as a singleton doc at goals/{user_id}.
suggest_goals calls the LLM with recent training context + bodyweight.
Errors return {"error": str} and never crash callers.
"""
import json
import logging
import time
from datetime import date

from app.config import get_settings
from app.firestore import get_db
from app.services import dashboard_service, llm, usage_service

logger = logging.getLogger(__name__)

SUGGEST_SYSTEM = (
    "You are a nutrition coach. Propose daily calorie and macro targets for a person "
    "based on their training volume, bodyweight, and stated goal. "
    "Return JSON only matching this schema: "
    '{"proposal": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}, '
    '"rationale": string (one concise sentence)}. '
    "Be conservative and practical. Round calories to nearest 50, macros to nearest 5g."
)


def get_goals(user_id: str) -> dict | None:
    snap = get_db().collection("goals").document(user_id).get()
    if not snap.exists:
        return None
    return {**snap.to_dict(), "id": snap.id}


def set_goals(user_id: str, payload: dict) -> dict:
    from datetime import datetime, timezone
    doc = {
        "user_id": user_id,
        "calories": payload["calories"],
        "protein_g": payload["protein_g"],
        "carbs_g": payload["carbs_g"],
        "fat_g": payload["fat_g"],
        "updated_at": datetime.now(timezone.utc),
    }
    get_db().collection("goals").document(user_id).set(doc)
    return {**doc, "id": user_id}


def suggest_goals(
    user_id: str,
    bodyweight_kg: float | None = None,
    goal_text: str = "",
) -> dict:
    s = get_settings()
    start = time.monotonic()
    try:
        today = date.today().isoformat()
        dash = dashboard_service.summary(user_id)
        context_parts = [
            f"Training this week: {dash.get('sessions_this_week', 0)} sessions, "
            f"volume {dash.get('week_volume', 0):.0f} kg, "
            f"streak {dash.get('streak_weeks', 0)} weeks.",
        ]
        if bodyweight_kg is not None:
            context_parts.append(f"Bodyweight: {bodyweight_kg} kg.")
        if goal_text:
            context_parts.append(f"Goal: {goal_text}.")
        user_content = " ".join(context_parts)
        resp = llm.complete(
            [
                {"role": "system", "content": SUGGEST_SYSTEM},
                {"role": "user", "content": user_content},
            ],
            model=s.nutrition_model,
            metadata={
                "generation_name": "nutrition-goals-suggest",
                "trace_user_id": user_id,
                "tags": ["nutrition", "goals"],
            },
        )
        usage = getattr(resp, "usage", None)
        usage_service.record_usage(
            user_id=user_id,
            source="nutrition_goals",
            model=s.nutrition_model,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
            duration_ms=int((time.monotonic() - start) * 1000),
        )
        raw = resp.choices[0].message.content or "{}"
        return json.loads(raw)
    except Exception as e:
        logger.exception("suggest_goals failed")
        return {"error": f"{type(e).__name__}: {e}"}
