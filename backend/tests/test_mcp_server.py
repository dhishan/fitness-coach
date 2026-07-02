"""Smoke tests for the FastMCP sub-app and tool registry."""
import asyncio
from unittest.mock import MagicMock, patch

import pytest

import app.mcp_server as mcp_server
from app.auth.mcp_auth import _current_user_id


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------


def test_tool_count():
    """Exactly 20 tools must be registered (12 workout + 8 nutrition/body/cardio)."""
    tools = asyncio.run(mcp_server.mcp.list_tools())
    assert len(tools) == 20


def test_tool_names():
    """All 20 expected tool names are present."""
    tools = asyncio.run(mcp_server.mcp.list_tools())
    names = {t.name for t in tools}
    expected = {
        "get_dashboard_summary",
        "get_workouts",
        "get_active_workout",
        "get_exercise_progress",
        "get_exercise_history",
        "get_alternatives",
        "list_exercises",
        "log_workout",
        "start_workout",
        "add_to_active_workout",
        "create_plan",
        "finish_active_workout",
        "log_food",
        "get_nutrition_logs",
        "get_nutrition_summary",
        "get_nutrition_goals",
        "list_recipes",
        "list_favorites",
        "get_body_metrics",
        "get_cardio_logs",
    }
    assert names == expected


# ---------------------------------------------------------------------------
# Unauthenticated guard
# ---------------------------------------------------------------------------


def test_tool_raises_when_unauthenticated():
    """Calling a tool without setting _current_user_id raises RuntimeError."""
    # Default ContextVar value is None — no token set.
    with pytest.raises(RuntimeError, match="unauthenticated"):
        mcp_server.get_dashboard_summary()


# ---------------------------------------------------------------------------
# get_dashboard_summary — happy path
# ---------------------------------------------------------------------------


def test_get_dashboard_summary_calls_service():
    """get_dashboard_summary calls dashboard_service.summary with correct args."""
    fake_summary = {
        "streak_weeks": 3,
        "week_volume": 5000.0,
        "sessions_this_week": 4,
        "muscle_split": {},
    }

    token = _current_user_id.set("u1")
    try:
        with patch.object(
            mcp_server.dashboard_service, "summary", return_value=fake_summary
        ) as mock_summary:
            result = mcp_server.get_dashboard_summary(reference_date="2026-06-12")

        mock_summary.assert_called_once_with("u1", "2026-06-12")
        assert result == fake_summary
    finally:
        _current_user_id.reset(token)


def test_get_dashboard_summary_defaults_to_today():
    """get_dashboard_summary passes today's date when reference_date is omitted."""
    from datetime import date

    token = _current_user_id.set("u1")
    try:
        with patch.object(
            mcp_server.dashboard_service, "summary", return_value={}
        ) as mock_summary:
            mcp_server.get_dashboard_summary()

        called_date = mock_summary.call_args[0][1]
        assert called_date == date.today().isoformat()
    finally:
        _current_user_id.reset(token)


def test_get_workouts_unwraps_items_and_passes_offset():
    """get_workouts calls list_workouts with offset and returns the items list.

    Regression: list_workouts(user, from, to, limit, offset) -> {"items", "total"}.
    The tool used to call it with 4 args and iterate the dict, raising TypeError.
    """
    from datetime import datetime, timezone

    ended = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
    page = {"items": [{"id": "w1", "date": "2026-06-01", "ended_at": ended}], "total": 1}

    token = _current_user_id.set("u1")
    try:
        with patch.object(
            mcp_server.workout_service, "list_workouts", return_value=page
        ) as mock_list:
            result = mcp_server.get_workouts(from_date="2026-06-01", to_date="2026-06-30", limit=5)

        mock_list.assert_called_once_with("u1", "2026-06-01", "2026-06-30", 5, 0)
        assert isinstance(result, list)
        assert result[0]["id"] == "w1"
        # datetimes are serialised to strings for JSON transport
        assert result[0]["ended_at"] == str(ended)
    finally:
        _current_user_id.reset(token)


def test_add_to_active_workout_appends_entry():
    active = {"id": "w1", "entries": [{"exercise_id": "e0", "exercise_name": "Squat", "sets": []}]}
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=active), \
             patch.object(mcp_server.exercise_service, "get_exercise", return_value={"id": "e1", "name": "Lat Pulldown"}), \
             patch.object(mcp_server.workout_service, "update_workout", return_value={"id": "w1", "entries": []}) as mock_upd:
            mcp_server.add_to_active_workout(exercise_id="e1", sets=[{"reps": 8, "weight": 50}])
        wid, uid, payload = mock_upd.call_args[0]
        assert wid == "w1" and uid == "u1"
        appended = payload["entries"][-1]
        assert appended["exercise_id"] == "e1"
        assert appended["exercise_name"] == "Lat Pulldown"
        assert appended["tracking"] == "reps"
        assert appended["sets"][0] == {"weight": 50.0, "reps": 8, "duration_s": None, "rpe": None, "is_warmup": False}
    finally:
        _current_user_id.reset(token)


def test_add_to_active_workout_time_exercise():
    from app.mcp_server import _current_user_id
    import app.mcp_server as mcp_server
    token = _current_user_id.set("u1")
    try:
        active = {"id": "w1", "entries": []}
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=active), \
             patch.object(mcp_server.exercise_service, "get_exercise",
                          return_value={"id": "sys-plank", "name": "Plank", "tracking": "time"}), \
             patch.object(mcp_server.workout_service, "update_workout", return_value={"id": "w1", "entries": []}) as mock_upd:
            mcp_server.add_to_active_workout(exercise_id="sys-plank", sets=[{"duration_s": 60}])
        appended = mock_upd.call_args[0][2]["entries"][-1]
        assert appended["tracking"] == "time"
        assert appended["sets"][0]["duration_s"] == 60
        assert appended["sets"][0]["reps"] == 0
    finally:
        _current_user_id.reset(token)


def test_add_to_active_workout_errors_without_active():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=None):
            result = mcp_server.add_to_active_workout(exercise_id="e1", sets=[])
        assert "error" in result
    finally:
        _current_user_id.reset(token)


def test_start_workout_creates_when_none_active():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=None), \
             patch.object(mcp_server.workout_service, "create_workout", return_value={"id": "w9", "entries": []}) as mock_create:
            result = mcp_server.start_workout(date="2026-06-28")
        uid, payload = mock_create.call_args[0]
        assert uid == "u1" and payload["date"] == "2026-06-28" and payload["entries"] == []
        assert result["id"] == "w9"
    finally:
        _current_user_id.reset(token)


def test_start_workout_returns_existing_active():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value={"id": "w1", "entries": []}), \
             patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.start_workout()
        mock_create.assert_not_called()  # don't start a second session
        assert result["id"] == "w1"
    finally:
        _current_user_id.reset(token)


def test_finish_active_workout_finishes_or_errors():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value={"id": "w1"}), \
             patch.object(mcp_server.workout_service, "finish_workout", return_value={"id": "w1", "total_volume": 1000}) as mock_fin:
            result = mcp_server.finish_active_workout()
        mock_fin.assert_called_once_with("w1", "u1")
        assert result["total_volume"] == 1000
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=None):
            assert "error" in mcp_server.finish_active_workout()
    finally:
        _current_user_id.reset(token)


def test_create_plan_resolves_names_and_calls_service():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.exercise_service, "get_exercise",
                          side_effect=lambda eid, uid: {"id": eid, "name": f"Ex-{eid}"}), \
             patch.object(mcp_server.template_service, "create_template",
                          return_value={"id": "t1", "name": "Push Day", "entries": []}) as mock_create:
            mcp_server.create_plan(name="Push Day", entries=[{"exercise_id": "e1"}, {"exercise_id": "e2", "target_sets": 5}])
        uid, payload = mock_create.call_args[0]
        assert uid == "u1" and payload["name"] == "Push Day"
        assert payload["entries"][0]["exercise_name"] == "Ex-e1"
        assert payload["entries"][0]["target_sets"] == 3  # default
        assert payload["entries"][1]["target_sets"] == 5
    finally:
        _current_user_id.reset(token)


# ---------------------------------------------------------------------------
# build_mcp_app returns an ASGI callable
# ---------------------------------------------------------------------------


def test_build_mcp_app_returns_asgi_callable():
    """build_mcp_app() must return an object callable as ASGI (has __call__)."""
    app = mcp_server.build_mcp_app()
    assert callable(app)


# ---------------------------------------------------------------------------
# Nutrition tools
# ---------------------------------------------------------------------------


def test_get_nutrition_logs_passes_user_and_date():
    fake = {"logs": [], "totals": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}}
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "list_by_date", return_value=fake) as m:
            result = mcp_server.get_nutrition_logs(date="2026-06-15")
        m.assert_called_once_with("u1", "2026-06-15")
        assert result == fake
    finally:
        _current_user_id.reset(token)


def test_log_food_builds_payload_and_serialises():
    from datetime import datetime, timezone

    created = {
        "id": "f1", "name": "Eggs (2)", "macros": {"calories": 140, "protein_g": 12, "carbs_g": 1, "fat_g": 10},
        "meal_type": "breakfast", "source": "mcp", "created_at": datetime(2026, 6, 15, 8, tzinfo=timezone.utc),
    }
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log", return_value=created) as m:
            result = mcp_server.log_food(
                name="Eggs (2)", calories=140, protein_g=12, carbs_g=1, fat_g=10,
                date="2026-06-15", meal_type="Breakfast",
                micros={"sodium_mg": 280, "cholesterol_mg": 370},
            )
        uid, payload = m.call_args[0]
        assert uid == "u1"
        assert payload["date"] == "2026-06-15"
        assert payload["macros"] == {"calories": 140, "protein_g": 12, "carbs_g": 1, "fat_g": 10}
        assert payload["meal_type"] == "breakfast"  # normalised to lowercase
        assert payload["source"] == "mcp"
        assert payload["micros"]["sodium_mg"] == 280
        assert payload["micros_source"] == "ai"
        # datetime serialised for JSON transport
        assert result["created_at"] == str(created["created_at"])
    finally:
        _current_user_id.reset(token)


def test_log_food_ignores_invalid_meal_type_and_requires_auth():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log", return_value={"id": "f2"}) as m:
            mcp_server.log_food(name="Apple", calories=95, meal_type="brunch")
        _uid, payload = m.call_args[0]
        assert "meal_type" not in payload  # "brunch" isn't a valid meal
        assert "micros" not in payload
    finally:
        _current_user_id.reset(token)
    with pytest.raises(RuntimeError, match="unauthenticated"):
        mcp_server.log_food(name="x", calories=1)


def test_get_nutrition_logs_defaults_to_today():
    from datetime import date
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "list_by_date", return_value={}) as m:
            mcp_server.get_nutrition_logs()
        assert m.call_args[0][1] == date.today().isoformat()
    finally:
        _current_user_id.reset(token)


def test_get_nutrition_logs_unauthenticated():
    with pytest.raises(RuntimeError, match="unauthenticated"):
        mcp_server.get_nutrition_logs()


def test_get_nutrition_summary_aggregates_days():
    fake_day = {"totals": {"calories": 1800, "protein_g": 120, "carbs_g": 200, "fat_g": 60}}
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "list_by_date", return_value=fake_day) as m:
            result = mcp_server.get_nutrition_summary(reference_date="2026-06-17", days=3)
        assert len(result) == 3
        assert m.call_count == 3
        # Returned chronologically ascending, ending at reference_date
        assert result[-1]["date"] == "2026-06-17"
        assert result[0]["date"] == "2026-06-15"
        assert all(r["calories"] == 1800 for r in result)
    finally:
        _current_user_id.reset(token)


def test_get_nutrition_summary_clamps_days():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "list_by_date", return_value={"totals": {}}) as m:
            mcp_server.get_nutrition_summary(reference_date="2026-06-17", days=100)
        assert m.call_count == 30
    finally:
        _current_user_id.reset(token)


def test_get_nutrition_goals_calls_service():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.goals_service, "get_goals", return_value={"calories": 2000}) as m:
            result = mcp_server.get_nutrition_goals()
        m.assert_called_once_with("u1")
        assert result == {"calories": 2000}
    finally:
        _current_user_id.reset(token)


def test_list_recipes_passes_user():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.recipe_service, "list_recipes", return_value=[{"id": "r1"}]) as m:
            result = mcp_server.list_recipes()
        m.assert_called_once_with("u1")
        assert result == [{"id": "r1"}]
    finally:
        _current_user_id.reset(token)


def test_list_favorites_passes_user():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "list_favorites", return_value=[{"id": "f1"}]) as m:
            result = mcp_server.list_favorites()
        m.assert_called_once_with("u1")
        assert result == [{"id": "f1"}]
    finally:
        _current_user_id.reset(token)


# ---------------------------------------------------------------------------
# Body + cardio tools
# ---------------------------------------------------------------------------


def test_get_body_metrics_clamps_limit():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.body_service, "list_metrics", return_value=[]) as m:
            mcp_server.get_body_metrics(limit=500)
        m.assert_called_once_with("u1", 90)
    finally:
        _current_user_id.reset(token)


def test_get_body_metrics_default_limit():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.body_service, "list_metrics", return_value=[]) as m:
            mcp_server.get_body_metrics()
        m.assert_called_once_with("u1", 30)
    finally:
        _current_user_id.reset(token)


def test_get_cardio_logs_passes_bounds_and_limit():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.cardio_service, "list_logs", return_value=[]) as m:
            mcp_server.get_cardio_logs(from_date="2026-06-01", to_date="2026-06-17", limit=50)
        m.assert_called_once_with("u1", "2026-06-01", "2026-06-17", 50)
    finally:
        _current_user_id.reset(token)


def test_get_cardio_logs_clamps_limit():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.cardio_service, "list_logs", return_value=[]) as m:
            mcp_server.get_cardio_logs(limit=500)
        assert m.call_args[0][3] == 90
    finally:
        _current_user_id.reset(token)


def test_all_new_tools_require_auth():
    """Every new read tool must raise when unauthenticated."""
    for fn in [
        mcp_server.get_nutrition_logs,
        mcp_server.get_nutrition_summary,
        mcp_server.get_nutrition_goals,
        mcp_server.list_recipes,
        mcp_server.list_favorites,
        mcp_server.get_body_metrics,
        mcp_server.get_cardio_logs,
    ]:
        with pytest.raises(RuntimeError, match="unauthenticated"):
            fn()


# ---------------------------------------------------------------------------
# Security: log_workout input validation
# ---------------------------------------------------------------------------

_VALID_ENTRIES = [{"exercise_id": "e1", "sets": [{"reps": 8, "weight": 100}]}]


def _ex_side_effect(eid, uid):
    if eid == "e1":
        return {"id": "e1", "name": "Bench Press"}
    return None


def test_log_workout_valid_calls_service():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.exercise_service, "get_exercise", side_effect=_ex_side_effect), \
             patch.object(mcp_server.workout_service, "create_workout", return_value={"id": "w1"}) as mock_create, \
             patch.object(mcp_server.workout_service, "finish_workout", return_value={"id": "w1", "total_volume": 800}):
            result = mcp_server.log_workout(date="2026-06-28", entries=_VALID_ENTRIES)
        assert result["id"] == "w1"
        _, payload = mock_create.call_args[0]
        assert payload["entries"][0]["exercise_id"] == "e1"
        assert payload["entries"][0]["sets"][0]["weight"] == 100.0
    finally:
        _current_user_id.reset(token)


def test_log_workout_too_many_entries_returns_error():
    token = _current_user_id.set("u1")
    try:
        big_entries = [{"exercise_id": "e1", "sets": []} for _ in range(51)]
        with patch.object(mcp_server.exercise_service, "get_exercise", side_effect=_ex_side_effect), \
             patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.log_workout(date="2026-06-28", entries=big_entries)
        assert "error" in result
        mock_create.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_workout_too_many_sets_returns_error():
    token = _current_user_id.set("u1")
    try:
        big_sets = [{"reps": 5, "weight": 100}] * 31
        entries = [{"exercise_id": "e1", "sets": big_sets}]
        with patch.object(mcp_server.exercise_service, "get_exercise", side_effect=_ex_side_effect), \
             patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.log_workout(date="2026-06-28", entries=entries)
        assert "error" in result
        mock_create.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_workout_negative_weight_returns_error():
    token = _current_user_id.set("u1")
    try:
        entries = [{"exercise_id": "e1", "sets": [{"reps": 8, "weight": -10}]}]
        with patch.object(mcp_server.exercise_service, "get_exercise", side_effect=_ex_side_effect), \
             patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.log_workout(date="2026-06-28", entries=entries)
        assert "error" in result
        mock_create.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_workout_invalid_rpe_returns_error():
    token = _current_user_id.set("u1")
    try:
        entries = [{"exercise_id": "e1", "sets": [{"reps": 8, "weight": 100, "rpe": 11}]}]
        with patch.object(mcp_server.exercise_service, "get_exercise", side_effect=_ex_side_effect), \
             patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.log_workout(date="2026-06-28", entries=entries)
        assert "error" in result
        mock_create.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_workout_unknown_exercise_returns_error():
    token = _current_user_id.set("u1")
    try:
        entries = [{"exercise_id": "unknown-99", "sets": [{"reps": 5, "weight": 50}]}]
        with patch.object(mcp_server.exercise_service, "get_exercise", return_value=None), \
             patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.log_workout(date="2026-06-28", entries=entries)
        assert "error" in result
        assert "unknown-99" in result["error"]
        mock_create.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_workout_bad_date_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "create_workout") as mock_create:
            result = mcp_server.log_workout(date="28-06-2026", entries=[])
        assert "error" in result
        mock_create.assert_not_called()
    finally:
        _current_user_id.reset(token)


# ---------------------------------------------------------------------------
# Security: log_food input validation
# ---------------------------------------------------------------------------


def test_log_food_valid_calls_service():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log", return_value={"id": "f1"}) as m:
            result = mcp_server.log_food(name="Chicken", calories=200, protein_g=40, carbs_g=0, fat_g=5)
        assert result["id"] == "f1"
        uid, payload = m.call_args[0]
        assert payload["macros"]["protein_g"] == 40
    finally:
        _current_user_id.reset(token)


def test_log_food_negative_calories_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log") as m:
            result = mcp_server.log_food(name="Bad", calories=-100)
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_food_nan_calories_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log") as m:
            result = mcp_server.log_food(name="Bad", calories=float("nan"))
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_food_inf_protein_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log") as m:
            result = mcp_server.log_food(name="Bad", calories=100, protein_g=float("inf"))
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_food_unknown_micro_key_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log") as m:
            result = mcp_server.log_food(
                name="Apple", calories=95,
                micros={"magic_nutrient_g": 999},
            )
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_food_negative_micro_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log") as m:
            result = mcp_server.log_food(
                name="Apple", calories=95,
                micros={"sodium_mg": -5},
            )
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_log_food_name_too_long_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.food_service, "create_log") as m:
            result = mcp_server.log_food(name="x" * 121, calories=100)
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


# ---------------------------------------------------------------------------
# Security: add_to_active_workout input validation
# ---------------------------------------------------------------------------


def test_add_to_active_workout_valid_passes():
    active = {"id": "w1", "entries": []}
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=active), \
             patch.object(mcp_server.exercise_service, "get_exercise", return_value={"id": "e1", "name": "Squat"}), \
             patch.object(mcp_server.workout_service, "update_workout", return_value={"id": "w1", "entries": []}) as m:
            result = mcp_server.add_to_active_workout("e1", [{"reps": 5, "weight": 120}])
        assert "error" not in result
        _, _, payload = m.call_args[0]
        assert payload["entries"][-1]["sets"][0]["weight"] == 120.0
    finally:
        _current_user_id.reset(token)


def test_add_to_active_workout_too_many_sets():
    active = {"id": "w1", "entries": []}
    token = _current_user_id.set("u1")
    try:
        big_sets = [{"reps": 5, "weight": 100}] * 31
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=active), \
             patch.object(mcp_server.exercise_service, "get_exercise", return_value={"id": "e1", "name": "Squat"}), \
             patch.object(mcp_server.workout_service, "update_workout") as m:
            result = mcp_server.add_to_active_workout("e1", big_sets)
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_add_to_active_workout_negative_reps():
    active = {"id": "w1", "entries": []}
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=active), \
             patch.object(mcp_server.exercise_service, "get_exercise", return_value={"id": "e1", "name": "Squat"}), \
             patch.object(mcp_server.workout_service, "update_workout") as m:
            result = mcp_server.add_to_active_workout("e1", [{"reps": -5, "weight": 100}])
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_add_to_active_workout_unknown_exercise():
    active = {"id": "w1", "entries": []}
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.workout_service, "get_active_workout", return_value=active), \
             patch.object(mcp_server.exercise_service, "get_exercise", return_value=None), \
             patch.object(mcp_server.workout_service, "update_workout") as m:
            result = mcp_server.add_to_active_workout("bad-id", [{"reps": 5, "weight": 100}])
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


# ---------------------------------------------------------------------------
# Security: create_plan input validation
# ---------------------------------------------------------------------------


def test_create_plan_valid_calls_service():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.exercise_service, "get_exercise",
                          side_effect=lambda eid, uid: {"id": eid, "name": f"Ex-{eid}"}), \
             patch.object(mcp_server.template_service, "create_template",
                          return_value={"id": "t1", "name": "Leg Day"}) as m:
            result = mcp_server.create_plan(name="Leg Day", entries=[{"exercise_id": "e1"}])
        assert result["id"] == "t1"
        _, payload = m.call_args[0]
        assert payload["entries"][0]["target_sets"] == 3
    finally:
        _current_user_id.reset(token)


def test_create_plan_too_many_entries_returns_error():
    token = _current_user_id.set("u1")
    try:
        big_entries = [{"exercise_id": "e1"}] * 51
        with patch.object(mcp_server.exercise_service, "get_exercise",
                          side_effect=lambda eid, uid: {"id": eid, "name": "Ex"}), \
             patch.object(mcp_server.template_service, "create_template") as m:
            result = mcp_server.create_plan(name="X", entries=big_entries)
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_create_plan_name_too_long_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.template_service, "create_template") as m:
            result = mcp_server.create_plan(name="x" * 81, entries=[])
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_create_plan_unknown_exercise_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.exercise_service, "get_exercise", return_value=None), \
             patch.object(mcp_server.template_service, "create_template") as m:
            result = mcp_server.create_plan(name="My Plan", entries=[{"exercise_id": "ghost-99"}])
        assert "error" in result
        assert "ghost-99" in result["error"]
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)


def test_create_plan_invalid_target_sets_returns_error():
    token = _current_user_id.set("u1")
    try:
        with patch.object(mcp_server.exercise_service, "get_exercise",
                          side_effect=lambda eid, uid: {"id": eid, "name": "Ex"}), \
             patch.object(mcp_server.template_service, "create_template") as m:
            result = mcp_server.create_plan(name="X", entries=[{"exercise_id": "e1", "target_sets": 25}])
        assert "error" in result
        m.assert_not_called()
    finally:
        _current_user_id.reset(token)
