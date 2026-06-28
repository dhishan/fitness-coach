"""Tests for the funny-workout-name generator (workout_title_service)."""
from unittest.mock import MagicMock, patch

from app.services import workout_title_service as wt


def _llm_resp(content: str, pt: int = 10, ct: int = 3):
    resp = MagicMock()
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp.choices = [choice]
    resp.usage.prompt_tokens = pt
    resp.usage.completion_tokens = ct
    return resp


def test_returns_none_when_workout_missing():
    with patch.object(wt.workout_service, "get_workout", return_value=None):
        assert wt.generate_and_save_title("w1", "u1") is None


def test_idempotent_when_already_titled():
    doc = {"id": "w1", "title": "Existing Name", "entries": [{"exercise_name": "Squat"}]}
    with patch.object(wt.workout_service, "get_workout", return_value=doc), \
         patch.object(wt.llm, "complete") as mock_llm:
        result = wt.generate_and_save_title("w1", "u1")
    mock_llm.assert_not_called()  # no LLM cost on re-fire
    assert result["title"] == "Existing Name"


def test_skips_when_no_exercises():
    doc = {"id": "w1", "entries": []}
    with patch.object(wt.workout_service, "get_workout", return_value=doc), \
         patch.object(wt.llm, "complete") as mock_llm:
        result = wt.generate_and_save_title("w1", "u1")
    mock_llm.assert_not_called()
    assert not (result.get("title") or "")


def test_generates_saves_and_sanitises_title():
    doc = {"id": "w1", "entries": [{"exercise_name": "Bench Press"}, {"exercise_name": "Squat"}]}
    db = MagicMock()
    with patch.object(wt.workout_service, "get_workout", return_value=doc), \
         patch.object(wt.llm, "complete", return_value=_llm_resp('"Bench & Beyond"\nignored second line')), \
         patch.object(wt.usage_service, "record_usage") as mock_usage, \
         patch.object(wt, "get_db", return_value=db):
        result = wt.generate_and_save_title("w1", "u1")
    # quotes + trailing line stripped
    assert result["title"] == "Bench & Beyond"
    db.collection.return_value.document.return_value.update.assert_called_once_with({"title": "Bench & Beyond"})
    # usage tracked under the workout_title source
    assert mock_usage.call_args.kwargs["source"] == "workout_title"


def test_llm_failure_leaves_workout_untitled():
    doc = {"id": "w1", "entries": [{"exercise_name": "Deadlift"}]}
    with patch.object(wt.workout_service, "get_workout", return_value=doc), \
         patch.object(wt.llm, "complete", side_effect=RuntimeError("llm down")), \
         patch.object(wt, "get_db") as mock_db:
        result = wt.generate_and_save_title("w1", "u1")
    assert not (result.get("title") or "")
    mock_db.assert_not_called()  # nothing written on failure


def test_generation_budget_caps_token_burn():
    """A looping client can't burn tokens past the hourly per-user cap."""
    wt._gen_hits.clear()
    db = MagicMock()
    # Fresh untitled doc per call (the service mutates title onto the doc).
    with patch.object(wt.workout_service, "get_workout",
                      side_effect=lambda wid, uid: {"id": wid, "entries": [{"exercise_name": "Squat"}]}), \
         patch.object(wt, "get_settings") as ms, \
         patch.object(wt.llm, "complete", return_value=_llm_resp("Leg Day")) as mock_llm, \
         patch.object(wt.usage_service, "record_usage"), \
         patch.object(wt, "get_db", return_value=db):
        ms.return_value.nutrition_model = "x"
        ms.return_value.workout_title_limit_per_hour = 2
        # Each call simulates a *different* untitled workout (doc has no title).
        wt.generate_and_save_title("w1", "u1")
        wt.generate_and_save_title("w2", "u1")
        wt.generate_and_save_title("w3", "u1")  # over budget -> no LLM call
    assert mock_llm.call_count == 2  # 3rd skipped by the budget
