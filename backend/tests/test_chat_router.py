from unittest.mock import MagicMock, patch

import pytest


def _llm_resp(text: str):
    r = MagicMock()
    r.choices = [MagicMock(message=MagicMock(content=text))]
    return r


# --- classify ---

@patch("app.chat.router.llm.complete", return_value=_llm_resp("simple"))
def test_classify_simple_verbatim(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "how many sessions this week"}])
    assert result == "simple"


@patch("app.chat.router.llm.complete", return_value=_llm_resp("complex"))
def test_classify_complex_verbatim(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "build me a 12-week program"}])
    assert result == "complex"


@patch("app.chat.router.llm.complete", return_value=_llm_resp("Simple."))
def test_classify_simple_with_punctuation(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "what's my best bench?"}])
    # "Simple." -> strip + lower -> "simple." -> split -> ["simple."] -- not exact "simple"
    # The spec says "simple" in text.split() -- "simple." != "simple"
    # Per plan: "Simple." lower stripped = "simple." -- split -> ["simple."] not "simple"
    # So this returns "complex" unless content matches exactly "simple"
    # Re-read plan: text = "Simple." -> strip().lower() = "simple." -> split() = ["simple."]
    # "simple" in ["simple."] is False -> "complex"
    # But the plan example says "Simple." -> returns "simple"
    # That means the implementation should handle this. Let's check what the actual code does:
    # text.split() for "simple." is ["simple."], "simple" in ["simple."] == False -> "complex"
    # The plan says patch to return "Simple." -> returns "simple" -- so the impl must handle it.
    # This means we need to check if "simple" is a substring of text, not in word list.
    # BUT the spec says: return "simple" if "simple" in text.split() else "complex"
    # This test must match the actual implementation. Let's test what the code does:
    # "simple." split -> ["simple."] -> "simple" not in it -> "complex"
    # The plan says this returns "simple". So either the code is wrong or test expectation differs.
    # Going with what the plan says: patch returns "Simple." -> result is "simple"
    # This means we need to adjust the impl to strip punctuation OR check substring.
    # For now, assert per the plan spec: "Simple." -> "simple"
    assert result == "simple"


@patch("app.chat.router.llm.complete", return_value=_llm_resp("I think complex."))
def test_classify_complex_with_preamble(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "give me a plan"}])
    assert result == "complex"


@patch("app.chat.router.llm.complete", side_effect=RuntimeError("api down"))
def test_classify_error_falls_back_to_complex(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "anything"}])
    assert result == "complex"


def test_classify_no_user_messages_returns_complex():
    from app.chat.router import classify
    result = classify([{"role": "system", "content": "sys prompt"}])
    assert result == "complex"


# --- select_model ---

@patch("app.chat.router.classify", return_value="simple")
def test_select_model_router_disabled_ignores_classification(mock_classify):
    from app.chat.router import select_model
    with patch("app.chat.router.get_settings") as mock_settings:
        s = MagicMock()
        s.chat_router_enabled = False
        s.chat_model = "openai/gpt-5.5"
        s.chat_model_cheap = "openai/gpt-4o-mini"
        mock_settings.return_value = s
        result = select_model([{"role": "user", "content": "hi"}])
    assert result == "openai/gpt-5.5"
    mock_classify.assert_not_called()


@patch("app.chat.router.classify", return_value="simple")
def test_select_model_router_enabled_simple_returns_cheap(mock_classify):
    from app.chat.router import select_model
    with patch("app.chat.router.get_settings") as mock_settings:
        s = MagicMock()
        s.chat_router_enabled = True
        s.chat_model = "openai/gpt-5.5"
        s.chat_model_cheap = "openai/gpt-4o-mini"
        mock_settings.return_value = s
        result = select_model([{"role": "user", "content": "how many sessions this week"}])
    assert result == "openai/gpt-4o-mini"


@patch("app.chat.router.classify", return_value="complex")
def test_select_model_router_enabled_complex_returns_main(mock_classify):
    from app.chat.router import select_model
    with patch("app.chat.router.get_settings") as mock_settings:
        s = MagicMock()
        s.chat_router_enabled = True
        s.chat_model = "openai/gpt-5.5"
        s.chat_model_cheap = "openai/gpt-4o-mini"
        mock_settings.return_value = s
        result = select_model([{"role": "user", "content": "build me a program"}])
    assert result == "openai/gpt-5.5"
