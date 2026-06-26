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
    """Exactly 15 tools must be registered (8 workout + 7 nutrition/body/cardio)."""
    tools = asyncio.run(mcp_server.mcp.list_tools())
    assert len(tools) == 15


def test_tool_names():
    """All 15 expected tool names are present."""
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
