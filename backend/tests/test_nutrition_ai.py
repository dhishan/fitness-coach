"""TDD tests for nutrition_ai service."""
import json
from unittest.mock import MagicMock, call, patch

import pytest


# ---- helpers ----

def _make_resp(content: str, prompt_tokens: int = 10, completion_tokens: int = 5):
    usage = MagicMock()
    usage.prompt_tokens = prompt_tokens
    usage.completion_tokens = completion_tokens
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = usage
    return resp


_GOOD_CONTENT = json.dumps({
    "name": "Scrambled eggs",
    "serving": "2 large eggs",
    "macros": {
        "calories": 180,
        "protein_g": 12.0,
        "carbs_g": 1.0,
        "fat_g": 13.0,
    },
    "confidence": 0.85,
})


# ---- estimate_from_text ----

def test_estimate_from_text_returns_parsed_dict():
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT, 10, 5)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.nutrition_ai.usage_service.record_usage") as mock_usage:
        result = nutrition_ai.estimate_from_text("user1", "two scrambled eggs")
    assert result["name"] == "Scrambled eggs"
    assert result["macros"]["calories"] == 180
    assert result["confidence"] == 0.85
    mock_complete.assert_called_once()


def test_estimate_from_text_records_usage():
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT, 10, 5)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp), \
         patch("app.services.nutrition_ai.usage_service.record_usage") as mock_usage:
        nutrition_ai.estimate_from_text("user1", "two scrambled eggs")
    mock_usage.assert_called_once()
    kwargs = mock_usage.call_args.kwargs
    assert kwargs["source"] == "nutrition_text"
    assert kwargs["user_id"] == "user1"
    assert kwargs["input_tokens"] == 10
    assert kwargs["output_tokens"] == 5


def test_estimate_from_text_uses_nutrition_model():
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.nutrition_ai.usage_service.record_usage"):
        nutrition_ai.estimate_from_text("user1", "oatmeal")
    kwargs = mock_complete.call_args.kwargs
    # model should be the nutrition_model from settings
    assert "gpt-4o-mini" in kwargs.get("model", "")


def test_estimate_from_text_error_returns_error_dict():
    from app.services import nutrition_ai
    with patch("app.services.nutrition_ai.llm.complete", side_effect=Exception("API down")), \
         patch("app.services.nutrition_ai.usage_service.record_usage") as mock_usage:
        result = nutrition_ai.estimate_from_text("user1", "pizza")
    assert "error" in result
    assert "API down" in result["error"]
    # record_usage must NOT be called on error
    mock_usage.assert_not_called()


# ---- estimate_from_image ----

def test_estimate_from_image_returns_parsed_dict():
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT, 20, 8)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.nutrition_ai.usage_service.record_usage") as mock_usage:
        result = nutrition_ai.estimate_from_image("user2", "https://example.com/photo.jpg", hint="dinner plate")
    assert result["macros"]["protein_g"] == 12.0
    mock_complete.assert_called_once()


def test_estimate_from_image_records_usage_source_photo():
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT, 20, 8)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp), \
         patch("app.services.nutrition_ai.usage_service.record_usage") as mock_usage:
        nutrition_ai.estimate_from_image("user2", "https://example.com/photo.jpg")
    kwargs = mock_usage.call_args.kwargs
    assert kwargs["source"] == "nutrition_photo"
    assert kwargs["input_tokens"] == 20
    assert kwargs["output_tokens"] == 8


def test_estimate_from_image_content_includes_image_url():
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.nutrition_ai.usage_service.record_usage"):
        nutrition_ai.estimate_from_image("user2", "https://example.com/food.jpg", hint="tacos")
    messages = mock_complete.call_args.args[0]
    user_msg = next(m for m in messages if m["role"] == "user")
    content = user_msg["content"]
    # should be a list with text + image_url parts
    assert isinstance(content, list)
    types = [part["type"] for part in content]
    assert "image_url" in types
    assert "text" in types
    img_part = next(p for p in content if p["type"] == "image_url")
    assert img_part["image_url"]["url"] == "https://example.com/food.jpg"


def test_estimate_from_image_error_does_not_record_usage():
    from app.services import nutrition_ai
    with patch("app.services.nutrition_ai.llm.complete", side_effect=RuntimeError("vision fail")), \
         patch("app.services.nutrition_ai.usage_service.record_usage") as mock_usage:
        result = nutrition_ai.estimate_from_image("user2", "https://example.com/food.jpg")
    assert "error" in result
    mock_usage.assert_not_called()


def test_estimate_from_image_default_hint():
    """No hint passed -> default hint text included."""
    from app.services import nutrition_ai
    resp = _make_resp(_GOOD_CONTENT)
    with patch("app.services.nutrition_ai.llm.complete", return_value=resp) as mock_complete, \
         patch("app.services.nutrition_ai.usage_service.record_usage"):
        nutrition_ai.estimate_from_image("user2", "https://example.com/food.jpg")
    messages = mock_complete.call_args.args[0]
    user_msg = next(m for m in messages if m["role"] == "user")
    text_part = next(p for p in user_msg["content"] if p["type"] == "text")
    assert len(text_part["text"]) > 0
