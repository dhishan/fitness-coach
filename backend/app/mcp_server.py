"""FastMCP sub-app exposing workout and dashboard tools.

Mount at /mcp via build_mcp_app() — see main.py.

Each tool reads the authenticated user_id from _current_user_id (set per-request
by McpAuthMiddleware). Tools raise RuntimeError("unauthenticated") if called
outside an authenticated context.
"""
import logging
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

from app.auth.mcp_auth import McpAuthMiddleware, _current_user_id, get_mcp_user_id
from app.services import dashboard_service, exercise_service, workout_service

logger = logging.getLogger(__name__)

mcp = FastMCP("fitness-tracker", stateless_http=True)


def _uid() -> str:
    uid = get_mcp_user_id()
    if uid is None:
        raise RuntimeError("unauthenticated")
    return uid


# ---------------------------------------------------------------------------
# Dashboard / summary tools
# ---------------------------------------------------------------------------


@mcp.tool()
def get_dashboard_summary(reference_date: Optional[str] = None) -> dict[str, Any]:
    """Return the weekly dashboard summary for the calling user.

    reference_date: YYYY-MM-DD. Defaults to today.
    Returns streak, weekly volume, sessions this week, and muscle split.
    """
    from datetime import date

    uid = _uid()
    ref = reference_date or date.today().isoformat()
    return dashboard_service.summary(uid, ref)


@mcp.tool()
def get_workouts(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 10,
) -> list[dict]:
    """List recent workouts for the calling user.

    from_date / to_date: optional YYYY-MM-DD bounds.
    limit: max number of workouts to return (default 10).
    """
    uid = _uid()
    workouts = workout_service.list_workouts(uid, from_date, to_date, limit)
    # Convert any datetime values to strings for JSON serialisation.
    result = []
    for w in workouts:
        row = {}
        for k, v in w.items():
            row[k] = str(v) if hasattr(v, "isoformat") else v
        result.append(row)
    return result


# ---------------------------------------------------------------------------
# Exercise tools
# ---------------------------------------------------------------------------


@mcp.tool()
def get_exercise_progress(exercise_id: str) -> list[dict]:
    """Return the volume-over-time progress series for a single exercise.

    exercise_id: the exercise document id.
    Returns a list of {date, volume} points sorted ascending.
    """
    uid = _uid()
    return dashboard_service.exercise_progress(uid, exercise_id)


@mcp.tool()
def get_exercise_history(exercise_id: str, limit: int = 3) -> list[dict]:
    """Return the last N workout appearances for an exercise.

    exercise_id: the exercise document id.
    limit: number of past sessions to return (default 3).
    """
    uid = _uid()
    return exercise_service.history_for(exercise_id, uid, limit)


@mcp.tool()
def get_alternatives(exercise_id: str) -> list[dict]:
    """Return ranked alternative exercises for the given exercise.

    Alternatives are ranked by muscle overlap and pattern similarity.
    exercise_id: the exercise document id.
    """
    uid = _uid()
    result = exercise_service.alternatives_for(exercise_id, uid)
    return result if result is not None else []


@mcp.tool()
def list_exercises(
    muscle: Optional[str] = None,
    pattern: Optional[str] = None,
    q: Optional[str] = None,
) -> list[dict]:
    """List exercises in the user's library with optional filters.

    muscle: filter by primary muscle group (e.g. 'chest', 'back').
    pattern: filter by movement pattern (e.g. 'push', 'pull', 'hinge').
    q: free-text search against exercise name.
    """
    uid = _uid()
    return exercise_service.list_exercises(uid, muscle=muscle, pattern=pattern, q=q)


# ---------------------------------------------------------------------------
# Workout logging tool
# ---------------------------------------------------------------------------


@mcp.tool()
def log_workout(date: str, entries: list[dict]) -> dict[str, Any]:
    """Create and immediately finish a workout, returning id, volume, and PRs.

    date: YYYY-MM-DD of the workout.
    entries: list of exercise entries in the same format as the REST API:
      [{"exercise_id": "...", "sets": [{"reps": 8, "weight": 100}, ...]}]

    Returns the finished workout document including total_volume and prs.
    """
    uid = _uid()
    workout = workout_service.create_workout(uid, {"date": date, "entries": entries})
    finished = workout_service.finish_workout(workout["id"], uid)
    return finished or workout


# ---------------------------------------------------------------------------
# Mount helper
# ---------------------------------------------------------------------------


def build_mcp_app():
    """Return the Streamable HTTP ASGI app wrapped with McpAuthMiddleware.

    Mount on the FastAPI app:
        app.mount("/mcp", build_mcp_app())
    """
    return McpAuthMiddleware(mcp.streamable_http_app())
