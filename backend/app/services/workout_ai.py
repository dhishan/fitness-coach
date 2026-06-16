"""AI suggestions for the workout screen.

`suggest_next_exercise` returns one structured exercise to add to the active
session, picked to balance muscle coverage with what the user already has in
their library. Uses the cheap model — this is an inline call on a tap.
"""
from __future__ import annotations

import json
import logging
import time

from app.config import get_settings
from app.services import exercise_service, goals_service, llm, usage_service, workout_service

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are a strength coach picking ONE next exercise to add to the user's "
    "in-progress workout. The user will approve or cancel in the UI before it's "
    "saved — your job is to make a good recommendation.\n\n"
    "Inputs:\n"
    "- intent: user's stated goal for THIS session + subjective state (energy/mental/"
    "physical on 1-10, where 10 is best). Treat this as load-bearing.\n"
    "- already_done: exercises in this session with primary muscles, top set, and "
    "average RPE across working sets. Higher avg_rpe (>= 8) = the user is taxed; "
    "lower (<= 6) = they have gas in the tank.\n"
    "- recent_history: muscle groups trained over the last ~5 sessions. Avoid "
    "suggesting a movement they hammered yesterday.\n"
    "- user_goals (optional): nutrition targets, coarse signal only.\n"
    "- candidates: exercises in the user's library (id, name, primary_muscles, pattern, equipment).\n\n"
    "How to use the signals:\n"
    "- If energy/physical <= 4 OR avg_rpe of completed work is high (>= 8.5): pick "
    "something LIGHTER or accessory (isolation, machines, lower reps with moderate "
    "weight). Do NOT add another heavy compound.\n"
    "- If energy/physical >= 7 AND avg_rpe so far is moderate (<= 7): a working "
    "compound is fair game.\n"
    "- If mental is low: prefer a familiar movement (already in their history), "
    "not a novel one.\n"
    "- If intent.goal mentions a body part or theme, prioritize it.\n\n"
    "Selection rules:\n"
    "- Pick from `candidates` ONLY. Never invent an exercise.\n"
    "- Match the apparent session theme (push / pull / legs / full body) from already_done.\n"
    "- Prefer a muscle group NOT yet directly hit, unless the user is clearly "
    "building single-muscle focus (3+ on one muscle) or intent.goal says so.\n"
    "- Reps: 3-5 for heavy compounds, 6-10 default, 12-15 for isolation/core/calves. "
    "Drop reps and add sets when the user is fresh; do the opposite when they're cooked.\n\n"
    "Return JSON only, no prose:\n"
    "{\n"
    '  "exercise_id": "<one of the candidate ids>",\n'
    '  "exercise_name": "<the name from candidates>",\n'
    '  "sets": 3,\n'
    '  "reps": 8,\n'
    '  "reason": "<one short sentence, max 16 words, says WHY this exercise NOW given the signals>"\n'
    "}"
)


def _compact(ex: dict) -> dict:
    return {
        "id": ex["id"],
        "name": ex.get("name", ""),
        "primary_muscles": ex.get("primary_muscles", []),
        "pattern": ex.get("movement_pattern"),
        "equipment": ex.get("equipment"),
    }


def suggest_next_exercise(user_id: str, workout_id: str) -> dict | None:
    """Return {exercise_id, exercise_name, sets, reps, reason} or None.

    None means we could not produce a suggestion (no active workout, library
    empty, or model returned junk).
    """
    workout = workout_service.get_workout(workout_id, user_id)
    if workout is None:
        return None
    library = exercise_service.list_exercises(user_id)
    if not library:
        return None

    already_done = []
    all_rpes: list[float] = []
    for e in workout.get("entries", []) or []:
        ex = next((x for x in library if x["id"] == e.get("exercise_id")), None)
        sets = e.get("sets") or []
        working = [s for s in sets if not s.get("is_warmup")] or sets
        top_set = ""
        if working:
            top = max(working, key=lambda s: (s.get("weight") or 0))
            w = top.get("weight") or 0
            r = top.get("reps") or 0
            if w or r:
                top_set = f"{w}kg x {r}"
        rpes = [float(s.get("rpe")) for s in working if s.get("rpe") is not None]
        avg_rpe = round(sum(rpes) / len(rpes), 1) if rpes else None
        if avg_rpe is not None:
            all_rpes.append(avg_rpe)
        already_done.append({
            "name": e.get("exercise_name", ""),
            "primary_muscles": ex.get("primary_muscles", []) if ex else [],
            "top_set": top_set,
            "avg_rpe": avg_rpe,
        })

    session_avg_rpe = round(sum(all_rpes) / len(all_rpes), 1) if all_rpes else None

    # Recent-history themes from the last ~7 days of finished sessions
    recent_workouts = workout_service.list_workouts(user_id, None, None, 10, 0) or []
    recent_history: list[str] = []
    for w in recent_workouts[:5]:
        if w.get("id") == workout_id:
            continue
        muscles: set[str] = set()
        for e in w.get("entries", []) or []:
            ex = next((x for x in library if x["id"] == e.get("exercise_id")), None)
            if ex:
                muscles.update(ex.get("primary_muscles", []) or [])
        if muscles:
            recent_history.append(f"{w.get('date','?')}: {', '.join(sorted(muscles))}")

    user_goals = goals_service.get_goals(user_id) or {}

    # Compact the candidate list to keep tokens small. 80 is plenty.
    candidates = [_compact(ex) for ex in library[:80]]

    user_payload = json.dumps({
        "intent": workout.get("intent") or {},
        "session_avg_rpe": session_avg_rpe,
        "already_done": already_done,
        "recent_history": recent_history,
        "user_goals": {k: user_goals.get(k) for k in ("calories", "protein_g") if user_goals.get(k)} or None,
        "candidates": candidates,
    })

    s = get_settings()
    # GPT-5-mini: latest mid-tier OpenAI model. Better instruction-following than
    # gpt-4o-mini at similar cost. Falls back to chat_model_cheap if env-overridden.
    model = "openai/gpt-5-mini"
    start = time.monotonic()
    try:
        resp = llm.complete(
            [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user_payload},
            ],
            model=model,
            metadata={
                "generation_name": "workout-next-suggestion",
                "trace_user_id": user_id,
                "tags": ["workout", "suggest"],
            },
        )
    except Exception:
        logger.exception("workout suggest llm call failed for %s", user_id)
        return None
    duration_ms = int((time.monotonic() - start) * 1000)

    usage = getattr(resp, "usage", None)
    usage_service.record_usage(
        user_id=user_id,
        source="workout_suggest",
        model=model,
        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        duration_ms=duration_ms,
    )

    try:
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
    except Exception:
        logger.warning("workout suggest returned non-json")
        return None

    ex_id = parsed.get("exercise_id")
    match = next((x for x in library if x["id"] == ex_id), None)
    if match is None:
        # Try matching by name as a fallback
        name = (parsed.get("exercise_name") or "").strip().lower()
        match = next((x for x in library if x["name"].strip().lower() == name), None)
    if match is None:
        return None

    return {
        "exercise_id": match["id"],
        "exercise_name": match["name"],
        "primary_muscles": match.get("primary_muscles", []),
        "movement_pattern": match.get("movement_pattern"),
        "equipment": match.get("equipment"),
        "sets": int(parsed.get("sets") or 3),
        "reps": int(parsed.get("reps") or 8),
        "reason": (parsed.get("reason") or "").strip(),
    }
