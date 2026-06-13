import json
from unittest.mock import MagicMock, patch


def _msg(content=None, tool_calls=None):
    m = MagicMock()
    m.content = content
    m.tool_calls = tool_calls
    return m


def _resp(content=None, tool_calls=None, prompt_tokens=10, completion_tokens=5):
    r = MagicMock()
    r.choices = [MagicMock(message=_msg(content, tool_calls))]
    r.usage = MagicMock(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
    return r


def _tc(name, args, id="tc1"):
    tc = MagicMock()
    tc.id = id
    tc.function = MagicMock(arguments=json.dumps(args))
    tc.function.name = name
    return tc


@patch("app.chat.generation.chat_store")
@patch("app.chat.generation.usage_service.record_usage", return_value=0.001)
@patch("app.chat.generation.llm.complete")
@patch("app.chat.generation.select_model", return_value="openai/gpt-5.5")
def test_simple_turn_no_tools(mock_select, mock_llm, mock_usage, mock_store, mock_db):
    from app.chat.generation import generate_turn_sync
    mock_llm.return_value = _resp(content="Hello! Nice squat streak.")
    mock_store.get_turn.return_value = {"id": "t1", "events": []}
    mock_store.append_events.side_effect = lambda c, t, turn, ev: turn
    generate_turn_sync("u1", "c1", "t1", [{"role": "user", "content": "hi"}])
    # text + done events appended
    flat = [e for call in mock_store.append_events.call_args_list for e in call.args[3]]
    types = [e["type"] for e in flat]
    assert "text" in types and types[-1] == "done"
    # usage recorded exactly once
    mock_usage.assert_called_once()
    kwargs = mock_usage.call_args.kwargs
    assert kwargs["input_tokens"] == 10 and kwargs["output_tokens"] == 5
    mock_store.finalize_turn.assert_called_once()


@patch("app.chat.generation.chat_store")
@patch("app.chat.generation.usage_service.record_usage", return_value=0.0)
@patch("app.chat.generation.execute_tool", return_value={"sessions_this_week": 3})
@patch("app.chat.generation.llm.complete")
@patch("app.chat.generation.select_model", return_value="openai/gpt-5.5")
def test_tool_loop_accumulates_usage(mock_select, mock_llm, mock_exec, mock_usage, mock_store, mock_db):
    from app.chat.generation import generate_turn_sync
    mock_llm.side_effect = [
        _resp(tool_calls=[_tc("get_dashboard_summary", {})], prompt_tokens=20, completion_tokens=8),
        _resp(content="You trained 3x this week.", prompt_tokens=40, completion_tokens=12),
    ]
    mock_store.get_turn.return_value = {"id": "t1", "events": []}
    mock_store.append_events.side_effect = lambda c, t, turn, ev: turn
    generate_turn_sync("u1", "c1", "t1", [{"role": "user", "content": "how's my week"}])
    mock_exec.assert_called_once_with("get_dashboard_summary", {}, user_id="u1")
    kwargs = mock_usage.call_args.kwargs
    assert kwargs["input_tokens"] == 60 and kwargs["output_tokens"] == 20  # accumulated
    mock_usage.assert_called_once()  # once per logical turn, not per sub-turn


@patch("app.chat.generation.chat_store")
@patch("app.chat.generation.usage_service.record_usage", return_value=0.001)
@patch("app.chat.generation.llm.complete")
@patch("app.chat.generation.select_model", return_value="openai/gpt-test-cheap")
def test_generation_uses_select_model_result(mock_select, mock_llm, mock_usage, mock_store, mock_db):
    from app.chat.generation import generate_turn_sync
    mock_llm.return_value = _resp(content="Done.")
    mock_store.get_turn.return_value = {"id": "t1", "events": []}
    mock_store.append_events.side_effect = lambda c, t, turn, ev: turn
    history = [{"role": "user", "content": "how many sessions this week"}]
    generate_turn_sync("u1", "c1", "t1", history)
    # llm.complete called with the cheap model
    call_kwargs = mock_llm.call_args.kwargs
    assert call_kwargs.get("model") == "openai/gpt-test-cheap"
    # record_usage also reflects the cheap model
    usage_kwargs = mock_usage.call_args.kwargs
    assert usage_kwargs["model"] == "openai/gpt-test-cheap"


@patch("app.chat.generation.chat_store")
@patch("app.chat.generation.usage_service.record_usage", return_value=0.0)
@patch("app.chat.generation.llm.complete", side_effect=RuntimeError("api down"))
@patch("app.chat.generation.select_model", return_value="openai/gpt-5.5")
def test_llm_failure_emits_error_event(mock_select, mock_llm, mock_usage, mock_store, mock_db):
    from app.chat.generation import generate_turn_sync
    mock_store.get_turn.return_value = {"id": "t1", "events": []}
    mock_store.append_events.side_effect = lambda c, t, turn, ev: turn
    generate_turn_sync("u1", "c1", "t1", [{"role": "user", "content": "hi"}])
    flat = [e for call in mock_store.append_events.call_args_list for e in call.args[3]]
    assert flat[-1]["type"] == "error"
    mock_store.finalize_turn.assert_called_once()  # finalized as failed
