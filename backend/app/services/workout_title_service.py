"""Generate a short, funny/punny name for a finished workout.

Triggered by the client right after finishing (fire-and-forget) so the save
itself is never delayed. Idempotent: a workout that already has a title is left
untouched, so re-fires cost nothing.
"""
import logging
import threading
import time
from collections import defaultdict, deque

from app.config import get_settings
from app.firestore import get_db
from app.services import llm, usage_service, workout_service

logger = logging.getLogger(__name__)

# Per-user backstop on NEW title generations (the LLM call). Idempotency already
# makes re-fires for an already-named workout free; this caps a buggy/looping
# client that hammers many untitled workouts. In-memory sliding window (1h),
# keyed by user_id. <=0 disables.
_gen_lock = threading.Lock()
_gen_hits: dict[str, deque] = defaultdict(deque)


def _within_generation_budget(user_id: str) -> bool:
    limit = get_settings().workout_title_limit_per_hour
    if limit <= 0:
        return True
    now = time.monotonic()
    with _gen_lock:
        dq = _gen_hits[user_id]
        cutoff = now - 3600.0
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True

_SYSTEM = (
    "You name a completed gym session with a SHORT, witty, punny title. "
    "Rules: 2-4 words, Title Case, no quotes, no emoji, no hashtags, keep it PG. "
    "Base it on the exercises trained. Return ONLY the title, nothing else."
)


def _llm_title(user_id: str, exercises: list[str]) -> str:
    s = get_settings()
    prompt = "Exercises trained: " + ", ".join(exercises[:12])
    start = time.monotonic()
    try:
        resp = llm.complete(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            model=s.nutrition_model,  # cheapest model; this is a tiny call
            metadata={
                "generation_name": "workout-title",
                "trace_user_id": user_id,
                "tags": ["workout-title"],
            },
        )
        usage = getattr(resp, "usage", None)
        usage_service.record_usage(
            user_id=user_id,
            source="workout_title",
            model=s.nutrition_model,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
            duration_ms=int((time.monotonic() - start) * 1000),
        )
        text = (resp.choices[0].message.content or "").strip()
        # Single line, strip stray quotes, hard cap length.
        text = text.splitlines()[0].strip().strip('"').strip("'").strip()
        return text[:60]
    except Exception:
        logger.exception("workout title generation failed")
        return ""


def generate_and_save_title(workout_id: str, user_id: str) -> dict | None:
    """Name a finished workout and persist `title`. Idempotent.

    Returns the workout doc (with title if one now exists), or None if the
    workout doesn't exist / isn't the caller's.
    """
    doc = workout_service.get_workout(workout_id, user_id)
    if doc is None:
        return None
    if (doc.get("title") or "").strip():
        return doc  # already named — no-op (and no LLM cost)
    exercises = [
        e.get("exercise_name")
        for e in (doc.get("entries") or [])
        if e.get("exercise_name")
    ]
    if not exercises:
        return doc  # nothing to base a name on
    if not _within_generation_budget(user_id):
        logger.warning(
            "workout title generation rate-limited user_id=%s",
            user_id,
            extra={"json_fields": {"event": "workout_title_rate_limited", "user_id": user_id}},
        )
        return doc  # over the hourly budget — skip; client just shows the date
    title = _llm_title(user_id, exercises)
    if not title:
        return doc
    get_db().collection("workouts").document(workout_id).update({"title": title})
    doc["title"] = title
    return doc
