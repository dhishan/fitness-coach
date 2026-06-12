from unittest.mock import MagicMock


def _store_with_mock():
    from app.services import chat_store
    db = MagicMock()
    return chat_store, db


def test_append_event_assigns_monotonic_seq():
    from app.services.chat_store import next_events
    turn = {"events": [
        {"seq": 1, "type": "text", "text": "hel"},
        {"seq": 2, "type": "text", "text": "lo"},
        {"seq": 3, "type": "done"},
    ]}
    assert [e["seq"] for e in next_events(turn, from_seq=0)] == [1, 2, 3]
    assert [e["seq"] for e in next_events(turn, from_seq=2)] == [3]
    assert next_events(turn, from_seq=99) == []


def test_turn_is_terminal():
    from app.services.chat_store import is_terminal
    assert is_terminal({"events": [{"seq": 1, "type": "done"}]}) is True
    assert is_terminal({"events": [{"seq": 1, "type": "error", "message": "x"}]}) is True
    assert is_terminal({"events": [{"seq": 1, "type": "text", "text": "hi"}]}) is False


def test_events_capped():
    from app.services.chat_store import cap_events
    events = [{"seq": i, "type": "text", "text": "x"} for i in range(1, 1001)]
    capped = cap_events(events, max_events=800)
    assert len(capped) == 800
    assert capped[-1]["seq"] == 1000  # newest kept
    assert capped[0]["seq"] == 201
