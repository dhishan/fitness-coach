import logging
from datetime import date

from app.services import dashboard_service, exercise_service, workout_service

logger = logging.getLogger(__name__)


def _summary(args: dict, user_id: str):
    return dashboard_service.summary(user_id, args.get("reference_date") or date.today().isoformat())


def _workouts(args: dict, user_id: str):
    return workout_service.list_workouts(
        user_id, args.get("from_date"), args.get("to_date"), int(args.get("limit", 10)), 0)


def _progress(args: dict, user_id: str):
    return dashboard_service.exercise_progress(user_id, args["exercise_id"])


def _history(args: dict, user_id: str):
    return exercise_service.history_for(args["exercise_id"], user_id, int(args.get("limit", 3)))


def _alternatives(args: dict, user_id: str):
    return exercise_service.alternatives_for(args["exercise_id"], user_id) or []


def _list_exercises(args: dict, user_id: str):
    return exercise_service.list_exercises(
        user_id, muscle=args.get("muscle"), pattern=args.get("pattern"), q=args.get("q"))


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
