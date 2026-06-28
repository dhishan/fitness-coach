"""FastMCP sub-app exposing workout and dashboard tools.

Mount at /mcp via build_mcp_app() — see main.py.

Each tool reads the authenticated user_id from _current_user_id (set per-request
by McpAuthMiddleware). Tools raise RuntimeError("unauthenticated") if called
outside an authenticated context.
"""
import logging
import math
from typing import Any, Optional

import pydantic
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.auth.mcp_auth import McpAuthMiddleware, _current_user_id, get_mcp_user_id
from app.schemas import Macros, Micros, SetEntry as SetEntrySchema
from app.services import (
    body_service,
    cardio_service,
    dashboard_service,
    exercise_service,
    food_service,
    goals_service,
    recipe_service,
    template_service,
    workout_service,
)

# ---------------------------------------------------------------------------
# Input-validation limits for write tools (public MCP connector)
# ---------------------------------------------------------------------------
_MAX_ENTRIES = 50       # max exercise entries per log_workout / create_plan call
_MAX_SETS = 30          # max sets per exercise entry
_MAX_NAME_LEN = 120     # mirrors FoodLogCreate.name max_length
_MAX_SERVING_LEN = 120  # reasonable cap for serving strings


def _validate_sets(sets: list[dict], label: str = "sets") -> tuple[list[dict] | None, str | None]:
    """Validate a list of raw set dicts through SetEntry schema.

    Returns (normalised_sets, None) on success, (None, error_string) on failure.
    Caps at _MAX_SETS and rejects negative/non-finite numeric values.
    """
    if len(sets) > _MAX_SETS:
        return None, f"{label}: too many sets ({len(sets)}); max is {_MAX_SETS}"
    normalised: list[dict] = []
    for i, s in enumerate(sets):
        try:
            validated = SetEntrySchema(
                weight=s.get("weight", 0),
                reps=s.get("reps", 0),
                rpe=s.get("rpe"),
                is_warmup=bool(s.get("is_warmup", False)),
            )
        except pydantic.ValidationError as exc:
            return None, f"{label}[{i}]: {exc.errors()[0]['msg']}"
        # Reject non-finite floats that pass ge=0 silently
        if not math.isfinite(validated.weight):
            return None, f"{label}[{i}].weight must be a finite number"
        if validated.rpe is not None and not math.isfinite(validated.rpe):
            return None, f"{label}[{i}].rpe must be a finite number"
        normalised.append({
            "weight": validated.weight,
            "reps": validated.reps,
            "rpe": validated.rpe,
            "is_warmup": validated.is_warmup,
        })
    return normalised, None

logger = logging.getLogger(__name__)

mcp = FastMCP(
    "fitness-tracker",
    stateless_http=True,
    streamable_http_path="/",
    # MCP's DNS-rebinding-protection rejects any Host/Origin not listed here
    # with HTTP 421. claude.ai / chatgpt.com hit mcp.fitness-tracker.* — list
    # it (and the api.* path + localhost) explicitly.
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[
            "mcp.fitness-tracker.blueelephants.org",
            "api.fitness-tracker.blueelephants.org",
            "127.0.0.1:*",
            "localhost:*",
        ],
        allowed_origins=[
            "https://claude.ai",
            "https://chatgpt.com",
            "https://chat.openai.com",
            "http://127.0.0.1:*",
            "http://localhost:*",
        ],
    ),
)


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
def get_active_workout() -> dict | None:
    """Return the user's IN-PROGRESS workout (started but not finished), or None.

    Use this BEFORE proposing fitness:add-to-workout cards so you know whether
    a session is actually running. If this returns None, do NOT emit
    fitness:add-to-workout — emit fitness:plan or just describe the exercise.
    """
    uid = _uid()
    w = workout_service.get_active_workout(uid)
    if w is None:
        return None
    row: dict[str, Any] = {}
    for k, v in w.items():
        row[k] = str(v) if hasattr(v, "isoformat") else v
    return row


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
    page = workout_service.list_workouts(uid, from_date, to_date, limit, 0)
    # list_workouts returns {"items": [...], "total": n}; serialise the items.
    result = []
    for w in page["items"]:
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
    import re
    uid = _uid()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {"error": "date must be YYYY-MM-DD"}
    if not isinstance(entries, list):
        return {"error": "entries must be a list"}
    if len(entries) > _MAX_ENTRIES:
        return {"error": f"Too many entries ({len(entries)}); max is {_MAX_ENTRIES}"}
    validated_entries: list[dict] = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            return {"error": f"entries[{i}] must be an object"}
        ex_id = e.get("exercise_id")
        if not ex_id or not isinstance(ex_id, str):
            return {"error": f"entries[{i}].exercise_id is required"}
        ex = exercise_service.get_exercise(ex_id, uid)
        if ex is None:
            return {"error": f"Unknown exercise_id {ex_id!r} at entries[{i}]. Use list_exercises to find it."}
        raw_sets = e.get("sets") or []
        if not isinstance(raw_sets, list):
            return {"error": f"entries[{i}].sets must be a list"}
        norm_sets, err = _validate_sets(raw_sets, label=f"entries[{i}].sets")
        if err:
            return {"error": err}
        validated_entries.append({
            "exercise_id": ex_id,
            "exercise_name": ex.get("name", ""),
            "superset_group": e.get("superset_group") if isinstance(e.get("superset_group"), str) else None,
            "sets": norm_sets,
        })
    workout = workout_service.create_workout(uid, {"date": date, "entries": validated_entries})
    finished = workout_service.finish_workout(workout["id"], uid)
    return finished or workout


def _serialise(d: dict) -> dict[str, Any]:
    return {k: (str(v) if hasattr(v, "isoformat") else v) for k, v in d.items()}


@mcp.tool()
def start_workout(date: Optional[str] = None) -> dict[str, Any]:
    """Start a new IN-PROGRESS (empty) workout so exercises can be added to it.

    Use this before add_to_active_workout when nothing is running. If a workout
    is already active, returns that one instead of starting a second. To log an
    already-finished session in one shot, use log_workout.

    date: YYYY-MM-DD. Defaults to today.

    Returns the active workout.
    """
    from datetime import date as _date

    uid = _uid()
    existing = workout_service.get_active_workout(uid)
    if existing is not None:
        return _serialise(existing)
    workout = workout_service.create_workout(uid, {"date": date or _date.today().isoformat(), "entries": []})
    return _serialise(workout)


@mcp.tool()
def add_to_active_workout(exercise_id: str, sets: list[dict]) -> dict[str, Any]:
    """Add an exercise (with its sets) to the user's IN-PROGRESS workout.

    Requires an active (started, not finished) workout. If there is none this
    returns {"error": ...}; tell the user to start a workout in the app, or use
    log_workout to record an already-completed session instead.

    exercise_id: exercise document id (resolve a name with list_exercises).
    sets: [{"reps": 8, "weight": 100}, ...]. weight in kg; use 0 for bodyweight.
      Optional per-set "rpe" (1-10) and "is_warmup" (bool).

    Returns the updated in-progress workout.
    """
    uid = _uid()
    active = workout_service.get_active_workout(uid)
    if active is None:
        return {"error": "No active workout. Start one in the app, or use log_workout for a completed session."}
    ex = exercise_service.get_exercise(exercise_id, uid)
    if ex is None:
        return {"error": f"Unknown exercise_id {exercise_id!r}. Use list_exercises to find it."}
    raw_sets = sets or []
    if not isinstance(raw_sets, list):
        return {"error": "sets must be a list"}
    norm_sets, err = _validate_sets(raw_sets, label="sets")
    if err:
        return {"error": err}
    entries = list(active.get("entries") or [])
    entries.append({
        "exercise_id": exercise_id,
        "exercise_name": ex.get("name", ""),
        "superset_group": None,
        "sets": norm_sets,
    })
    updated = workout_service.update_workout(active["id"], uid, {"entries": entries})
    if updated is None:
        return {"error": "Could not update the active workout."}
    return _serialise(updated)


@mcp.tool()
def create_plan(name: str, entries: list[dict]) -> dict[str, Any]:
    """Create a reusable workout plan (template).

    name: plan name, e.g. "Push Day".
    entries: ordered exercises, each {"exercise_id": "...", "target_sets": 3,
      "superset_group": null}. Resolve ids with list_exercises; target_sets
      defaults to 3; exercise_name is filled in automatically.

    Returns the created plan.
    """
    uid = _uid()
    # Validate name length (mirrors TemplateCreate max_length=80)
    if not name or len(name.strip()) == 0:
        return {"error": "name is required"}
    if len(name) > 80:
        return {"error": "name is too long (max 80 chars)"}
    if not isinstance(entries, list):
        return {"error": "entries must be a list"}
    if len(entries) > _MAX_ENTRIES:
        return {"error": f"Too many entries ({len(entries)}); max is {_MAX_ENTRIES}"}
    built: list[dict] = []
    for i, e in enumerate(entries or []):
        if not isinstance(e, dict):
            return {"error": f"entries[{i}] must be an object"}
        ex_id = e.get("exercise_id")
        if not ex_id:
            continue
        if not isinstance(ex_id, str):
            return {"error": f"entries[{i}].exercise_id must be a string"}
        ex = exercise_service.get_exercise(ex_id, uid)
        if ex is None:
            return {"error": f"Unknown exercise_id {ex_id!r}. Use list_exercises to find it."}
        try:
            target_sets = int(e.get("target_sets") or 3)
        except (TypeError, ValueError):
            return {"error": f"entries[{i}].target_sets must be an integer"}
        if target_sets < 1 or target_sets > 20:
            return {"error": f"entries[{i}].target_sets must be between 1 and 20"}
        built.append({
            "exercise_id": ex_id,
            "exercise_name": ex.get("name", ""),
            "target_sets": target_sets,
            "superset_group": e.get("superset_group") if isinstance(e.get("superset_group"), str) else None,
        })
    if not built:
        return {"error": "No valid exercises. Provide entries with an exercise_id each."}
    created = template_service.create_template(uid, {"name": name, "entries": built})
    return _serialise(created)


@mcp.tool()
def finish_active_workout() -> dict[str, Any]:
    """Finish the user's in-progress workout, returning total volume and any PRs.

    Returns {"error": ...} if no workout is active.
    """
    uid = _uid()
    active = workout_service.get_active_workout(uid)
    if active is None:
        return {"error": "No active workout to finish."}
    finished = workout_service.finish_workout(active["id"], uid)
    return _serialise(finished) if finished else {"error": "Could not finish the workout."}


# ---------------------------------------------------------------------------
# Mount helper
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Nutrition tools
# ---------------------------------------------------------------------------


@mcp.tool()
def log_food(
    name: str,
    calories: float,
    protein_g: float = 0,
    carbs_g: float = 0,
    fat_g: float = 0,
    date: Optional[str] = None,
    serving: str = "",
    meal_type: Optional[str] = None,
    micros: Optional[dict] = None,
) -> dict[str, Any]:
    """Log a food the user ate, with macros (and optional micros).

    Call once per distinct food. For "2 eggs and a banana", make two calls.

    name: what was eaten, e.g. "Scrambled eggs (2)".
    calories/protein_g/carbs_g/fat_g: totals for the whole entry as eaten.
    date: YYYY-MM-DD. Defaults to today.
    serving: optional human label, e.g. "1 bowl (~250g)".
    meal_type: breakfast | lunch | dinner | snack (optional).
    micros: optional per-entry dict; any of fiber_g, sugar_g, sodium_mg,
      potassium_mg, calcium_mg, iron_mg, vitamin_c_mg, vitamin_d_mcg,
      saturated_fat_g, cholesterol_mg. Omit fields you cannot estimate.

    Returns the created food log document.
    """
    from datetime import date as _date

    uid = _uid()

    # --- validate string lengths ---
    if len(name) > _MAX_NAME_LEN:
        return {"error": f"name is too long (max {_MAX_NAME_LEN} chars)"}
    if len(serving) > _MAX_SERVING_LEN:
        return {"error": f"serving is too long (max {_MAX_SERVING_LEN} chars)"}

    # --- validate macros via Pydantic (catches negative and wrong types) ---
    try:
        m_obj = Macros(calories=calories, protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)
    except pydantic.ValidationError as exc:
        return {"error": f"macros: {exc.errors()[0]['msg']}"}
    for field, val in [("calories", m_obj.calories), ("protein_g", m_obj.protein_g),
                       ("carbs_g", m_obj.carbs_g), ("fat_g", m_obj.fat_g)]:
        if not math.isfinite(val):
            return {"error": f"macros.{field} must be a finite number"}

    # --- validate micros ---
    validated_micros: dict | None = None
    if micros:
        if not isinstance(micros, dict):
            return {"error": "micros must be an object"}
        _known_micro_keys = {
            "fiber_g", "sugar_g", "sodium_mg", "potassium_mg", "calcium_mg",
            "iron_mg", "vitamin_c_mg", "vitamin_d_mcg", "saturated_fat_g", "cholesterol_mg",
        }
        unknown = set(micros.keys()) - _known_micro_keys
        if unknown:
            return {"error": f"micros contains unknown keys: {sorted(unknown)}"}
        try:
            mi_obj = Micros(**micros)
        except pydantic.ValidationError as exc:
            return {"error": f"micros: {exc.errors()[0]['msg']}"}
        # Reject non-finite
        for k, v in mi_obj.model_dump().items():
            if not math.isfinite(v):
                return {"error": f"micros.{k} must be a finite number"}
        validated_micros = mi_obj.model_dump(exclude_defaults=False)
        # Only include keys that were explicitly provided
        validated_micros = {k: v for k, v in validated_micros.items() if k in micros}

    payload: dict[str, Any] = {
        "date": date or _date.today().isoformat(),
        "name": name,
        "serving": serving,
        "macros": {
            "calories": m_obj.calories,
            "protein_g": m_obj.protein_g,
            "carbs_g": m_obj.carbs_g,
            "fat_g": m_obj.fat_g,
        },
        "source": "mcp",
    }
    mt = (meal_type or "").strip().lower()
    if mt in ("breakfast", "lunch", "dinner", "snack"):
        payload["meal_type"] = mt
    if validated_micros is not None:
        payload["micros"] = validated_micros
        payload["micros_source"] = "ai"
    result = food_service.create_log(uid, payload)
    return {k: (str(v) if hasattr(v, "isoformat") else v) for k, v in result.items()}


# ---------------------------------------------------------------------------
# Nutrition tools (read-only)
# ---------------------------------------------------------------------------


@mcp.tool()
def get_nutrition_logs(date: Optional[str] = None) -> dict[str, Any]:
    """Return today's (or a given date's) food logs with macro/micro totals.

    date: YYYY-MM-DD. Defaults to today.
    Returns {items: [...], totals: {...macros}, micros_totals: {...}, incomplete}.
    """
    from datetime import date as _date
    uid = _uid()
    d = date or _date.today().isoformat()
    return food_service.list_by_date(uid, d)


@mcp.tool()
def get_nutrition_summary(reference_date: Optional[str] = None, days: int = 7) -> list[dict]:
    """Daily nutrition totals over the trailing N days.

    reference_date: YYYY-MM-DD. Defaults to today.
    days: how many trailing days to include (default 7, max 30).
    Returns a list of {date, calories, protein_g, carbs_g, fat_g, incomplete}.

    IMPORTANT: days with "incomplete": true were marked by the user as
    untracked (e.g. eating out) — their totals are NOT a real record of
    intake. EXCLUDE incomplete days from averages and never conclude the
    user ate little on those days.
    """
    from datetime import date as _date, timedelta
    uid = _uid()
    ref_str = reference_date or _date.today().isoformat()
    ref = _date.fromisoformat(ref_str)
    days = max(1, min(int(days), 30))
    out: list[dict] = []
    for i in range(days - 1, -1, -1):
        d = (ref - timedelta(days=i)).isoformat()
        day = food_service.list_by_date(uid, d)
        totals = (day or {}).get("totals") or {}
        out.append({"date": d, **totals, "incomplete": bool((day or {}).get("incomplete"))})
    return out


@mcp.tool()
def get_nutrition_goals() -> dict | None:
    """Return the user's nutrition goals (kcal + macros + micros targets), or None."""
    uid = _uid()
    return goals_service.get_goals(uid)


@mcp.tool()
def list_recipes() -> list[dict]:
    """List the user's saved recipes with per-serving macros."""
    uid = _uid()
    return recipe_service.list_recipes(uid)


@mcp.tool()
def list_favorites() -> list[dict]:
    """List the user's favorited foods with per-serving macros."""
    uid = _uid()
    return food_service.list_favorites(uid)


# ---------------------------------------------------------------------------
# Body + cardio tools (read-only)
# ---------------------------------------------------------------------------


@mcp.tool()
def get_body_metrics(limit: int = 30) -> list[dict]:
    """Recent body metrics (weight, body fat %, circumferences). Sorted newest first.

    limit: how many entries to return (default 30, max 90).
    """
    uid = _uid()
    limit = max(1, min(int(limit), 90))
    return body_service.list_metrics(uid, limit)


@mcp.tool()
def get_cardio_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    """List recent cardio sessions with activity, duration, distance, kcal.

    from_date / to_date: optional YYYY-MM-DD bounds.
    limit: max number to return (default 20, max 90).
    """
    uid = _uid()
    limit = max(1, min(int(limit), 90))
    return cardio_service.list_logs(uid, from_date, to_date, limit)


# ---------------------------------------------------------------------------
# Mount helper
# ---------------------------------------------------------------------------


def build_mcp_app():
    """Return the Streamable HTTP ASGI app wrapped with McpAuthMiddleware.

    Mount on the FastAPI app:
        app.mount("/mcp", build_mcp_app())
    """
    return McpAuthMiddleware(mcp.streamable_http_app())
