"""TDD tests for goals_service."""
import json
from unittest.mock import MagicMock, patch

import pytest


def _make_snap(data: dict, doc_id: str = "doc1", exists: bool = True):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = exists
    snap.to_dict.return_value = data
    return snap


_GOOD_PROPOSAL = json.dumps({
    "proposal": {"calories": 2200, "protein_g": 160, "carbs_g": 240, "fat_g": 70},
    "rationale": "Based on your training volume and 75kg bodyweight.",
})


# ---- get_goals ----

def test_get_goals_returns_doc(mock_db):
    from app.services.goals_service import get_goals
    data = {
        "user_id": "user1",
        "calories": 2000, "protein_g": 150, "carbs_g": 220, "fat_g": 60,
        "updated_at": None,
    }
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(data, "user1")
    result = get_goals("user1")
    assert result["calories"] == 2000
    assert result["user_id"] == "user1"


def test_get_goals_returns_none_when_missing(mock_db):
    from app.services.goals_service import get_goals
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(
        {}, exists=False
    )
    result = get_goals("user1")
    assert result is None


# ---- set_goals ----

def test_set_goals_upserts(mock_db):
    from app.services.goals_service import set_goals
    payload = {"calories": 2200, "protein_g": 160, "carbs_g": 240, "fat_g": 70}
    ref = mock_db.collection.return_value.document.return_value
    result = set_goals("user1", payload)
    ref.set.assert_called_once()
    written = ref.set.call_args[0][0]
    assert written["calories"] == 2200
    assert written["user_id"] == "user1"
    assert result["calories"] == 2200


def test_set_goals_stores_user_id(mock_db):
    from app.services.goals_service import set_goals
    payload = {"calories": 1800, "protein_g": 130, "carbs_g": 200, "fat_g": 55}
    ref = mock_db.collection.return_value.document.return_value
    result = set_goals("user2", payload)
    written = ref.set.call_args[0][0]
    assert written["user_id"] == "user2"


# ---- suggest_goals ----

def test_suggest_goals_returns_proposal_and_rationale(mock_db):
    from app.services import goals_service
    msg = MagicMock()
    msg.content = _GOOD_PROPOSAL
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = MagicMock()
    resp.usage.prompt_tokens = 50
    resp.usage.completion_tokens = 20

    with patch("app.services.goals_service.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.goals_service.dashboard_service.summary", return_value={
             "sessions_this_week": 3,
             "week_volume": 12000,
             "streak_weeks": 4,
         }) as mock_summary, \
         patch("app.services.goals_service.usage_service.record_usage") as mock_usage:
        result = goals_service.suggest_goals("user1", bodyweight_kg=75.0, goal_text="lose fat")

    assert "proposal" in result
    assert result["proposal"]["calories"] == 2200
    assert "rationale" in result
    assert len(result["rationale"]) > 0
    mock_complete.assert_called_once()
    mock_summary.assert_called_once()
    assert mock_summary.call_args.args[0] == "user1"
    mock_usage.assert_called_once()


def test_suggest_goals_records_usage_with_correct_source(mock_db):
    from app.services import goals_service
    msg = MagicMock()
    msg.content = _GOOD_PROPOSAL
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = MagicMock()
    resp.usage.prompt_tokens = 50
    resp.usage.completion_tokens = 20

    with patch("app.services.goals_service.llm.complete", return_value=resp), \
         patch("app.services.goals_service.dashboard_service.summary", return_value={}), \
         patch("app.services.goals_service.usage_service.record_usage") as mock_usage:
        goals_service.suggest_goals("user1")

    kwargs = mock_usage.call_args.kwargs
    assert kwargs["source"] == "nutrition_goals"
    assert kwargs["user_id"] == "user1"
    assert kwargs["input_tokens"] == 50
    assert kwargs["output_tokens"] == 20


def test_suggest_goals_error_returns_error_dict(mock_db):
    from app.services import goals_service
    with patch("app.services.goals_service.llm.complete", side_effect=Exception("LLM down")), \
         patch("app.services.goals_service.dashboard_service.summary", return_value={}), \
         patch("app.services.goals_service.usage_service.record_usage") as mock_usage:
        result = goals_service.suggest_goals("user1")
    assert "error" in result
    # usage not recorded on error
    mock_usage.assert_not_called()


def test_suggest_goals_falls_back_to_body_service_weight(mock_db):
    """When bodyweight_kg is None, suggest_goals should query body_service.latest_weight."""
    from app.services import goals_service
    msg = MagicMock()
    msg.content = _GOOD_PROPOSAL
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = MagicMock()
    resp.usage.prompt_tokens = 50
    resp.usage.completion_tokens = 20

    with patch("app.services.goals_service.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.goals_service.dashboard_service.summary", return_value={}), \
         patch("app.services.goals_service.body_service.latest_weight", return_value=75.0) as mock_bw, \
         patch("app.services.goals_service.usage_service.record_usage"):
        result = goals_service.suggest_goals("user1")  # no bodyweight_kg passed

    mock_bw.assert_called_once_with("user1")
    messages = mock_complete.call_args.args[0]
    user_content = next(m["content"] for m in messages if m["role"] == "user")
    assert "75" in user_content  # weight from body_service was injected


def test_suggest_goals_fallback_not_called_when_weight_provided(mock_db):
    """When bodyweight_kg is provided, body_service.latest_weight should NOT be called."""
    from app.services import goals_service
    msg = MagicMock()
    msg.content = _GOOD_PROPOSAL
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = MagicMock()
    resp.usage.prompt_tokens = 50
    resp.usage.completion_tokens = 20

    with patch("app.services.goals_service.llm.complete", return_value=resp), \
         patch("app.services.goals_service.dashboard_service.summary", return_value={}), \
         patch("app.services.goals_service.body_service.latest_weight") as mock_bw, \
         patch("app.services.goals_service.usage_service.record_usage"):
        goals_service.suggest_goals("user1", bodyweight_kg=80.0)

    mock_bw.assert_not_called()


def test_suggest_goals_includes_context_in_prompt(mock_db):
    from app.services import goals_service
    msg = MagicMock()
    msg.content = _GOOD_PROPOSAL
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = MagicMock()
    resp.usage.prompt_tokens = 50
    resp.usage.completion_tokens = 20

    with patch("app.services.goals_service.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.goals_service.dashboard_service.summary", return_value={
             "sessions_this_week": 5,
             "streak_weeks": 8,
         }), \
         patch("app.services.goals_service.usage_service.record_usage"):
        goals_service.suggest_goals("user1", bodyweight_kg=80.0, goal_text="build muscle")

    messages = mock_complete.call_args.args[0]
    user_content = next(m["content"] for m in messages if m["role"] == "user")
    assert "80" in user_content  # bodyweight
    assert "build muscle" in user_content
