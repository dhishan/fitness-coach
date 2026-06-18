import logging
from datetime import date

from app.services import dashboard_service, exercise_service, workout_service

logger = logging.getLogger(__name__)


def _summary(args: dict, user_id: str):
    return dashboard_service.summary(user_id, args.get("reference_date") or date.today().isoformat())


def _slim_workout(w: dict) -> dict:
    """Compact representation for tool results — drop heavy fields the LLM rarely needs."""
    entries = w.get("entries") or []
    slim_entries = []
    for e in entries:
        sets = e.get("sets") or []
        top = None
        for st in sets:
            if st.get("is_warmup"):
                continue
            if top is None or float(st.get("weight") or 0) >= float(top.get("weight") or 0):
                top = st
        slim_entries.append({
            "exercise_id": e.get("exercise_id"),
            "exercise_name": e.get("exercise_name"),
            "set_count": len(sets),
            "top_set": {"weight": (top or {}).get("weight"), "reps": (top or {}).get("reps")} if top else None,
        })
    return {
        "id": w.get("id"),
        "date": w.get("date"),
        "total_volume": w.get("total_volume"),
        "entries": slim_entries,
    }


def _workouts(args: dict, user_id: str):
    limit = min(int(args.get("limit", 5)), 10)
    res = workout_service.list_workouts(
        user_id, args.get("from_date"), args.get("to_date"), limit, 0)
    items = (res.get("items") if isinstance(res, dict) else res) or []
    return {"items": [_slim_workout(w) for w in items], "total": (res.get("total") if isinstance(res, dict) else len(items))}


def _progress(args: dict, user_id: str):
    points = dashboard_service.exercise_progress(user_id, args["exercise_id"]) or []
    return points[-20:]


def _history(args: dict, user_id: str):
    limit = min(int(args.get("limit", 3)), 5)
    return exercise_service.history_for(args["exercise_id"], user_id, limit)


def _alternatives(args: dict, user_id: str):
    alts = exercise_service.alternatives_for(args["exercise_id"], user_id) or []
    return [{"id": a.get("id"), "name": a.get("name"),
             "primary_muscles": a.get("primary_muscles"),
             "equipment": a.get("equipment")} for a in alts[:8]]


def _list_exercises(args: dict, user_id: str):
    items = exercise_service.list_exercises(
        user_id, muscle=args.get("muscle"), pattern=args.get("pattern"), q=args.get("q")) or []
    capped = items[:25]
    slim = [{"id": e.get("id"), "name": e.get("name"),
             "primary_muscles": e.get("primary_muscles"),
             "movement_pattern": e.get("movement_pattern"),
             "equipment": e.get("equipment")} for e in capped]
    return {"items": slim, "total_in_library": len(items),
            "truncated": len(items) > 25,
            "next": "ask for more with a narrower filter (muscle / pattern / q)" if len(items) > 25 else None}


REGISTRY = {
    "get_dashboard_summary": _summary,
    "get_workouts": _workouts,
    "get_exercise_progress": _progress,
    "get_exercise_history": _history,
    "get_alternatives": _alternatives,
    "list_exercises": _list_exercises,
}


def execute_tool(name: str, args: dict, user_id: str):
    fn = REGISTRY.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(args or {}, user_id)
    except Exception as e:
        logger.exception("tool %s failed", name)
        return {"error": f"{type(e).__name__}: {e}"}
