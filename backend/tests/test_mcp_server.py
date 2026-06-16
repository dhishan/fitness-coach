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
    """Exactly 8 tools must be registered."""
    tools = asyncio.run(mcp_server.mcp.list_tools())
    assert len(tools) == 8


def test_tool_names():
    """All 8 expected tool names are present."""
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


# ---------------------------------------------------------------------------
# build_mcp_app returns an ASGI callable
# ---------------------------------------------------------------------------


def test_build_mcp_app_returns_asgi_callable():
    """build_mcp_app() must return an object callable as ASGI (has __call__)."""
    app = mcp_server.build_mcp_app()
    assert callable(app)
