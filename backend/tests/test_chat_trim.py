"""Verify in-turn tool-exchange pruning keeps the latest round and replaces
the older ones with a single short summary line. Cost driver: full tool
payloads were replayed each agentic round; pruning bounds it at O(1) per
round instead of O(N)."""
from app.chat.generation import _trim_tool_exchanges


def _round(call_id, name, payload):
    return [
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": call_id, "type": "function",
                          "function": {"name": name, "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": call_id, "content": payload},
    ]


SYS_USER = [
    {"role": "system", "content": "sys"},
    {"role": "user", "content": "q1"},
]


def test_trim_keeps_last_exchange():
    msgs = SYS_USER + _round("1", "get_workouts", "huge_payload_1") + \
                      _round("2", "list_exercises", "huge_payload_2") + \
                      _round("3", "get_history", "huge_payload_3")
    out = _trim_tool_exchanges(msgs, keep_last=1)
    # The final tool result must still be present verbatim
    tool_msgs = [m for m in out if m["role"] == "tool"]
    assert len(tool_msgs) == 1
    assert tool_msgs[0]["content"] == "huge_payload_3"


def test_trim_replaces_older_with_summary():
    msgs = SYS_USER + _round("1", "get_workouts", "p1") + _round("2", "list_exercises", "p2")
    out = _trim_tool_exchanges(msgs, keep_last=1)
    # Older tool_call assistant + tool result collapse to one short assistant note
    summary = [m for m in out if m["role"] == "assistant" and "earlier tool calls" in (m.get("content") or "")]
    assert len(summary) == 1
    assert "get_workouts" in summary[0]["content"]
    # The summary should NOT include the latest call name
    assert "list_exercises" not in summary[0]["content"]


def test_trim_no_op_when_under_keep_last():
    msgs = SYS_USER + _round("1", "get_workouts", "p1")
    out = _trim_tool_exchanges(msgs, keep_last=1)
    assert out == msgs


def test_trim_preserves_system_and_user_messages():
    msgs = SYS_USER + _round("1", "a", "p") + _round("2", "b", "p") + _round("3", "c", "p")
    out = _trim_tool_exchanges(msgs, keep_last=1)
    assert out[0] == {"role": "system", "content": "sys"}
    assert out[1] == {"role": "user", "content": "q1"}


def test_trim_keep_last_zero_drops_everything_tool():
    msgs = SYS_USER + _round("1", "a", "huge") + _round("2", "b", "huge2")
    out = _trim_tool_exchanges(msgs, keep_last=0)
    assert not any(m["role"] == "tool" for m in out)
    assert not any(m.get("tool_calls") for m in out)


def test_trim_cost_estimate_3_rounds_vs_1():
    """Sanity: trimming should remove >90% of tool-payload bytes for a 3-call turn."""
    big = "x" * 10_000
    msgs = SYS_USER + _round("1", "get_workouts", big) + \
                      _round("2", "list_exercises", big) + \
                      _round("3", "get_history", big)
    out = _trim_tool_exchanges(msgs, keep_last=1)
    total_in = sum(len(str(m.get("content") or "")) + len(str(m.get("tool_calls") or "")) for m in msgs)
    total_out = sum(len(str(m.get("content") or "")) + len(str(m.get("tool_calls") or "")) for m in out)
    assert total_out < total_in * 0.4, f"expected >60% reduction, got {total_out}/{total_in}"
