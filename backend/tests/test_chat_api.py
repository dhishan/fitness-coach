import json
from unittest.mock import patch

STORE = "app.routers.chat.chat_store"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_start_creates_conversation_and_turns(client):
    with patch(STORE + ".create_conversation", return_value={"id": "c1"}) as mc, \
         patch(STORE + ".create_turn", side_effect=[{"id": "tu"}, {"id": "ta"}]), \
         patch(STORE + ".list_turns", return_value=[]), \
         patch("app.routers.chat._spawn_generation") as spawn:
        r = client.post("/api/v1/chat/start", json={"message": "how's my bench?"},
                        headers=_auth(client))
    assert r.status_code == 200
    body = r.json()
    assert body == {"conversation_id": "c1", "user_turn_id": "tu", "assistant_turn_id": "ta"}
    spawn.assert_called_once()


def test_start_existing_conversation_404_cross_user(client):
    with patch(STORE + ".get_conversation", return_value=None):
        r = client.post("/api/v1/chat/start", json={"message": "x", "conversation_id": "other"},
                        headers=_auth(client))
    assert r.status_code == 404


def test_list_and_get_conversations(client):
    with patch(STORE + ".list_conversations", return_value=[{"id": "c1", "title": "Bench"}]):
        assert client.get("/api/v1/chat/conversations", headers=_auth(client)).json()[0]["id"] == "c1"
    with patch(STORE + ".get_conversation", return_value={"id": "c1"}), \
         patch(STORE + ".list_turns", return_value=[{"id": "t1", "role": "user"}]):
        r = client.get("/api/v1/chat/conversations/c1", headers=_auth(client))
    assert r.json()["turns"][0]["id"] == "t1"


def test_stream_replays_events_and_ends_on_done(client):
    turn = {"id": "ta", "user_id": "u1", "events": [
        {"seq": 1, "type": "text", "text": "hi"}, {"seq": 2, "type": "done"}]}
    with patch(STORE + ".get_turn", return_value=turn):
        with client.stream("GET", "/api/v1/chat/conversations/c1/turns/ta/stream?from_seq=0",
                           headers=_auth(client)) as r:
            assert r.status_code == 200
            body = "".join(chunk for chunk in r.iter_text())
    payloads = [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]
    assert [p["seq"] for p in payloads] == [1, 2]
    assert payloads[-1]["type"] == "done"


def test_stream_404_cross_user(client):
    with patch(STORE + ".get_turn", return_value=None):
        r = client.get("/api/v1/chat/conversations/c1/turns/ta/stream", headers=_auth(client))
    assert r.status_code == 404


def test_usage_summary(client):
    with patch("app.routers.usage.usage_service.monthly_summary",
               return_value={"month": "2026-06", "cost_usd": 0.42}):
        r = client.get("/api/v1/usage/summary?month=2026-06", headers=_auth(client))
    assert r.json()["cost_usd"] == 0.42
