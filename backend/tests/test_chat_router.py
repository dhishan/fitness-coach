from unittest.mock import MagicMock, patch

import pytest


def _llm_resp(text: str):
    r = MagicMock()
    r.choices = [MagicMock(message=MagicMock(content=text))]
    return r


# A medium-length, no-strong-signal message that bypasses the heuristic and
# actually reaches the LLM classifier.
_MEDIUM = (
    "I was curious about the general approach folks usually take with their "
    "training and nutrition over a longer stretch of time"
)


# --- classify: heuristic short-circuits (no LLM call) ---

@patch("app.chat.router.llm.complete", return_value=_llm_resp("simple"))
def test_classify_short_message_is_simple_without_llm(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "how many sessions this week"}])
    assert result == "simple"
    mock_llm.assert_not_called()


@patch("app.chat.router.llm.complete", return_value=_llm_resp("simple"))
def test_classify_keyword_program_is_complex_without_llm(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": "build me a 12-week program please"}])
    assert result == "complex"
    mock_llm.assert_not_called()


@patch("app.chat.router.llm.complete", return_value=_llm_resp("simple"))
def test_classify_plan_keyword_is_complex(mock_llm):
    from app.chat.router import classify
    assert classify([{"role": "user", "content": "give me a plan"}]) == "complex"


@patch("app.chat.router.llm.complete", return_value=_llm_resp("simple"))
def test_classify_plank_does_not_trigger_plan(mock_llm):
    from app.chat.router import classify
    # "plank" must not match the "plan" complex keyword
    assert classify([{"role": "user", "content": "how many planks should I do"}]) == "simple"


# --- classify: medium/long reaches the LLM classifier ---

@patch("app.chat.router.llm.complete", return_value=_llm_resp("Simple."))
def test_classify_medium_llm_simple_with_punctuation(mock_llm):
    from app.chat.router import classify
    result = classify([{"role": "user", "content": _MEDIUM}])
    assert result == "simple"
    mock_llm.assert_called_once()


@patch("app.chat.router.llm.complete", return_value=_llm_resp("I think this is complex."))
def test_classify_medium_llm_complex(mock_llm):
    from app.chat.router import classify
    assert classify([{"role": "user", "content": _MEDIUM}]) == "complex"


@patch("app.chat.router.llm.complete", return_value=_llm_resp("gibberish output"))
def test_classify_unrecognized_output_biases_simple(mock_llm):
    from app.chat.router import classify
    # anything not clearly "complex" -> cheap model
    assert classify([{"role": "user", "content": _MEDIUM}]) == "simple"


@patch("app.chat.router.llm.complete", side_effect=RuntimeError("api down"))
def test_classify_error_falls_back_to_complex(mock_llm):
    from app.chat.router import classify
    # medium message reaches the LLM; on error it prefers quality
    assert classify([{"role": "user", "content": _MEDIUM}]) == "complex"


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
