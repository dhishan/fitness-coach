from unittest.mock import patch


def test_definitions_are_openai_shaped():
    from app.chat.tools.definitions import TOOLS
    names = [t["function"]["name"] for t in TOOLS]
    assert set(names) == {
        "get_dashboard_summary", "get_workouts", "get_exercise_progress",
        "get_exercise_history", "get_alternatives", "list_exercises",
    }
    for t in TOOLS:
        assert t["type"] == "function"
        assert "parameters" in t["function"]


def test_executor_dispatches_by_registry():
    from app.chat.tools.executor import execute_tool
    with patch("app.chat.tools.executor.dashboard_service.summary",
               return_value={"sessions_this_week": 2}) as m:
        out = execute_tool("get_dashboard_summary", {"reference_date": "2026-06-12"}, user_id="u1")
    assert out == {"sessions_this_week": 2}
    m.assert_called_once_with("u1", "2026-06-12")


def test_executor_unknown_tool_returns_error_payload():
    from app.chat.tools.executor import execute_tool
    out = execute_tool("nope", {}, user_id="u1")
    assert out["error"].startswith("Unknown tool")


def test_executor_catches_exceptions():
    from app.chat.tools.executor import execute_tool
    with patch("app.chat.tools.executor.dashboard_service.summary", side_effect=RuntimeError("boom")):
        out = execute_tool("get_dashboard_summary", {}, user_id="u1")
    assert "error" in out
