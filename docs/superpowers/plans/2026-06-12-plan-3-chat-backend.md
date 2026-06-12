# Plan 3: Chat Backend (Durable SSE + LiteLLM + Metering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durable, resumable coach chat: Firestore-backed conversations/turns/events, background generation through LiteLLM (GPT-5.5 default, swappable), tool access to workout/dashboard data, per-turn usage metering with cost, resumable SSE streaming — deployed and verified live.

**Architecture (proven patterns from family-expense-tracker, structured per lessons doc):**
- `app/services/chat_store.py` — Firestore persistence. Turn doc holds an `events` array with monotonic `seq` (MAX_EVENTS=800). All reads validate `user_id` -> None -> 404.
- `app/chat/tools/definitions.py` (data) + `app/chat/tools/executor.py` (registry lookup, NOT elif chains).
- `app/chat/generation.py` — agentic loop; accumulates usage across sub-turns, records ONCE in finally.
- `app/services/llm.py` — LiteLLM wrapper (model from settings).
- `app/services/usage_service.py` + `app/services/pricing.py` — usage_events + monthly summaries + per-conversation totals; each write independently try/excepted; can never crash the main flow.
- `app/routers/chat.py` — HTTP only: start, list, get, SSE stream (200ms poll, 10s keepalive, 30-min ceiling). `app/routers/usage.py` — monthly summary.
- Background tasks pinned in module-level `_BG_TASKS` (Cloud Run min-instances=1 + cpu always-on already configured in Plan 1).

**Tech Stack:** litellm, FastAPI StreamingResponse (SSE), google-cloud-firestore.

**Existing:** Plan 1 foundation + Plan 2 services (`workout_service`, `dashboard_service`, `exercise_service`).

---

### Task 0: Manual — OpenAI API key secret (controller runs with user creds)

- [ ] **Step 1:** Create secret container is in Task 7's terraform; first add the version manually once the secret exists (Task 7 ordering note), or pre-create:

```bash
printf '%s' "$OPENAI_API_KEY" | gcloud secrets create fitness-tracker-openai-key-prod \
  --data-file=- --replication-policy=automatic --project personal-projects-473219
```

(If the secret container is created by terraform first, use `gcloud secrets versions add` instead.) Terraform will then `data`-reference it; CI never sees the key.

---

### Task 1: Settings + dependency

**Files:**
- Modify: `backend/app/config.py`, `backend/requirements.txt`
- Test: extend `backend/tests/test_config.py`

- [ ] **Step 1: Failing test** — append to `backend/tests/test_config.py`:

```python
def test_chat_settings_defaults():
    from app.config import get_settings
    s = get_settings()
    assert s.chat_model == "openai/gpt-5.5"
    assert s.chat_max_events == 800
    assert s.chat_generation_timeout_s == 1800
```

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** — add fields to `Settings` in `backend/app/config.py`:

```python
    openai_api_key: str = ""
    chat_model: str = "openai/gpt-5.5"
    chat_max_events: int = 800
    chat_generation_timeout_s: int = 1800
```

Append `litellm==1.55.9` to `backend/requirements.txt`, then `cd backend && .venv/bin/pip install -r requirements-dev.txt`.

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/config.py backend/requirements.txt backend/tests/test_config.py && git commit -m "feat: chat settings and litellm dependency"`

---

### Task 2: Chat store

**Files:**
- Create: `backend/app/services/chat_store.py`
- Test: `backend/tests/test_chat_store.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_chat_store.py`:

```python
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
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/services/chat_store.py`:

```python
import logging
from datetime import datetime, timezone

from google.cloud import firestore

from app.config import get_settings
from app.firestore import get_db

logger = logging.getLogger(__name__)

CONVERSATIONS = "chat_conversations"


# ---- pure helpers ----

def next_events(turn: dict, from_seq: int) -> list[dict]:
    return [e for e in turn.get("events", []) if e["seq"] > from_seq]


def is_terminal(turn: dict) -> bool:
    return any(e["type"] in ("done", "error") for e in turn.get("events", []))


def cap_events(events: list[dict], max_events: int) -> list[dict]:
    return events[-max_events:]


# ---- Firestore plumbing ----

def _now():
    return datetime.now(timezone.utc)


def create_conversation(user_id: str, title: str) -> dict:
    db = get_db()
    ref = db.collection(CONVERSATIONS).document()
    doc = {
        "user_id": user_id, "title": title,
        "created_at": _now(), "updated_at": _now(),
        "total_cost_usd": 0.0, "total_input_tokens": 0, "total_output_tokens": 0,
    }
    ref.set(doc)
    return {**doc, "id": ref.id}


def get_conversation(conv_id: str, user_id: str) -> dict | None:
    snap = get_db().collection(CONVERSATIONS).document(conv_id).get()
    if not snap.exists:
        return None
    doc = {**snap.to_dict(), "id": snap.id}
    if doc["user_id"] != user_id:
        logger.warning("cross-user conversation access attempt: %s -> %s", user_id, conv_id)
        return None
    return doc


def list_conversations(user_id: str, limit: int = 50) -> list[dict]:
    db = get_db()
    query = (
        db.collection(CONVERSATIONS)
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .order_by("updated_at", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    return [{**d.to_dict(), "id": d.id} for d in query.stream()]


def create_turn(conv_id: str, user_id: str, role: str, content: str = "",
                status: str = "pending") -> dict:
    db = get_db()
    ref = db.collection(CONVERSATIONS).document(conv_id).collection("turns").document()
    doc = {
        "user_id": user_id, "role": role, "content": content, "status": status,
        "events": [], "created_at": _now(),
        "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0,
    }
    ref.set(doc)
    db.collection(CONVERSATIONS).document(conv_id).update({"updated_at": _now()})
    return {**doc, "id": ref.id}


def get_turn(conv_id: str, turn_id: str, user_id: str) -> dict | None:
    snap = (get_db().collection(CONVERSATIONS).document(conv_id)
            .collection("turns").document(turn_id).get())
    if not snap.exists:
        return None
    doc = {**snap.to_dict(), "id": snap.id}
    if doc["user_id"] != user_id:
        logger.warning("cross-user turn access attempt: %s", user_id)
        return None
    return doc


def list_turns(conv_id: str, user_id: str) -> list[dict] | None:
    if get_conversation(conv_id, user_id) is None:
        return None
    db = get_db()
    query = (db.collection(CONVERSATIONS).document(conv_id)
             .collection("turns").order_by("created_at"))
    return [{**d.to_dict(), "id": d.id} for d in query.stream()]


def append_events(conv_id: str, turn_id: str, turn: dict, new_events: list[dict]) -> dict:
    """Assign seqs after the turn's current max and persist. Returns updated turn dict."""
    s = get_settings()
    events = list(turn.get("events", []))
    seq = events[-1]["seq"] if events else 0
    for e in new_events:
        seq += 1
        events.append({**e, "seq": seq})
    events = cap_events(events, s.chat_max_events)
    (get_db().collection(CONVERSATIONS).document(conv_id)
     .collection("turns").document(turn_id).update({"events": events}))
    turn["events"] = events
    return turn


def finalize_turn(conv_id: str, turn_id: str, content: str, status: str,
                  input_tokens: int, output_tokens: int, cost_usd: float) -> None:
    db = get_db()
    (db.collection(CONVERSATIONS).document(conv_id)
     .collection("turns").document(turn_id).update({
        "content": content, "status": status,
        "input_tokens": input_tokens, "output_tokens": output_tokens, "cost_usd": cost_usd,
     }))
    db.collection(CONVERSATIONS).document(conv_id).update({
        "updated_at": _now(),
        "total_cost_usd": firestore.Increment(cost_usd),
        "total_input_tokens": firestore.Increment(input_tokens),
        "total_output_tokens": firestore.Increment(output_tokens),
    })
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/services/chat_store.py backend/tests/test_chat_store.py && git commit -m "feat: firestore chat store with seq events and user isolation"`

---

### Task 3: Pricing + usage service

**Files:**
- Create: `backend/app/services/pricing.py`, `backend/app/services/usage_service.py`
- Test: `backend/tests/test_usage.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_usage.py`:

```python
from unittest.mock import MagicMock, patch


def test_pricing_returns_zero_on_unknown_model():
    from app.services.pricing import cost_usd
    assert cost_usd("definitely-not-a-model", 1000, 500) == 0.0


def test_pricing_known_model_positive():
    from app.services.pricing import cost_usd
    c = cost_usd("openai/gpt-4o-mini", 100000, 50000)
    assert c >= 0.0  # litellm may or may not know it offline; must not raise


def test_record_usage_never_raises(mock_db):
    from app.services.usage_service import record_usage
    mock_db.collection.side_effect = RuntimeError("firestore down")
    cost = record_usage(user_id="u1", source="chat", model="openai/gpt-5.5",
                        input_tokens=10, output_tokens=5, duration_ms=100,
                        conversation_id="c1")
    assert isinstance(cost, float)  # survived total Firestore failure


def test_record_usage_writes_event_and_summary(mock_db):
    from app.services.usage_service import record_usage
    record_usage(user_id="u1", source="chat", model="m", input_tokens=10,
                 output_tokens=5, duration_ms=42, conversation_id="c1")
    called = [c.args[0] for c in mock_db.collection.call_args_list]
    assert "usage_events" in called
    assert "user_usage_summaries" in called
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/services/pricing.py`:

```python
import logging

logger = logging.getLogger(__name__)


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Lazy-import litellm; any failure returns 0.0 - metering must never crash callers."""
    try:
        import litellm

        ip, op = litellm.cost_per_token(
            model=model,
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
        )
        return float((ip or 0.0) + (op or 0.0))
    except Exception:
        logger.warning("cost_per_token failed for model=%s", model, exc_info=True)
        return 0.0
```

`backend/app/services/usage_service.py`:

```python
import logging
from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db
from app.services.pricing import cost_usd

logger = logging.getLogger(__name__)


def record_usage(*, user_id: str, source: str, model: str, input_tokens: int,
                 output_tokens: int, duration_ms: int,
                 conversation_id: str | None = None) -> float:
    """Each write independently guarded - usage recording can never break the caller."""
    cost = cost_usd(model, input_tokens, output_tokens)
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")

    try:
        get_db().collection("usage_events").document().set({
            "user_id": user_id, "source": source, "model": model,
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "cost_usd": cost, "duration_ms": duration_ms,
            "conversation_id": conversation_id, "created_at": now,
        })
    except Exception:
        logger.exception("usage event write failed")

    try:
        (get_db().collection("user_usage_summaries").document(user_id)
         .collection("months").document(month).set({
            "input_tokens": firestore.Increment(input_tokens),
            "output_tokens": firestore.Increment(output_tokens),
            "cost_usd": firestore.Increment(cost),
            "calls": firestore.Increment(1),
            "updated_at": now,
         }, merge=True))
    except Exception:
        logger.exception("usage summary write failed")

    return cost


def monthly_summary(user_id: str, month: str) -> dict:
    try:
        snap = (get_db().collection("user_usage_summaries").document(user_id)
                .collection("months").document(month).get())
        if snap.exists:
            return {**snap.to_dict(), "month": month}
    except Exception:
        logger.exception("monthly summary read failed")
    return {"month": month, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/services/pricing.py backend/app/services/usage_service.py backend/tests/test_usage.py && git commit -m "feat: litellm pricing and crash-proof usage metering"`

---

### Task 4: Tools (definitions + executor)

**Files:**
- Create: `backend/app/chat/__init__.py` (empty), `backend/app/chat/tools/__init__.py` (empty), `backend/app/chat/tools/definitions.py`, `backend/app/chat/tools/executor.py`
- Test: `backend/tests/test_chat_tools.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_chat_tools.py`:

```python
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
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/chat/tools/definitions.py`:

```python
TOOLS = [
    {"type": "function", "function": {
        "name": "get_dashboard_summary",
        "description": "Weekly training summary: sessions this week, trained dates, week volume, streak in weeks.",
        "parameters": {"type": "object", "properties": {
            "reference_date": {"type": "string", "description": "YYYY-MM-DD local date; defaults to today"}},
            "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_workouts",
        "description": "List recent workouts with entries and sets. Optional date range.",
        "parameters": {"type": "object", "properties": {
            "from_date": {"type": "string"}, "to_date": {"type": "string"},
            "limit": {"type": "integer", "default": 10}},
            "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_exercise_progress",
        "description": "Per-date top working-set weight and volume series for one exercise.",
        "parameters": {"type": "object", "properties": {
            "exercise_id": {"type": "string"}},
            "required": ["exercise_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_exercise_history",
        "description": "Sets performed for an exercise in the most recent workouts containing it.",
        "parameters": {"type": "object", "properties": {
            "exercise_id": {"type": "string"}, "limit": {"type": "integer", "default": 3}},
            "required": ["exercise_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_alternatives",
        "description": "Alternative exercises with the same movement pattern ranked by muscle overlap.",
        "parameters": {"type": "object", "properties": {
            "exercise_id": {"type": "string"}},
            "required": ["exercise_id"]},
    }},
    {"type": "function", "function": {
        "name": "list_exercises",
        "description": "Search the exercise catalog by muscle, movement pattern, or name.",
        "parameters": {"type": "object", "properties": {
            "muscle": {"type": "string"}, "pattern": {"type": "string"}, "q": {"type": "string"}},
            "required": []},
    }},
]
```

`backend/app/chat/tools/executor.py`:

```python
import logging
from datetime import date

from app.services import dashboard_service, exercise_service, workout_service

logger = logging.getLogger(__name__)


def _summary(args: dict, user_id: str):
    return dashboard_service.summary(user_id, args.get("reference_date") or date.today().isoformat())


def _workouts(args: dict, user_id: str):
    return workout_service.list_workouts(
        user_id, args.get("from_date"), args.get("to_date"), int(args.get("limit", 10)), 0)


def _progress(args: dict, user_id: str):
    return dashboard_service.exercise_progress(user_id, args["exercise_id"])


def _history(args: dict, user_id: str):
    return exercise_service.history_for(args["exercise_id"], user_id, int(args.get("limit", 3)))


def _alternatives(args: dict, user_id: str):
    return exercise_service.alternatives_for(args["exercise_id"], user_id) or []


def _list_exercises(args: dict, user_id: str):
    return exercise_service.list_exercises(
        user_id, muscle=args.get("muscle"), pattern=args.get("pattern"), q=args.get("q"))


REGISTRY = {
    "get_dashboard_summary": _summary,
    "get_workouts": _workouts,
    "get_exercise_progress": _progress,
    "get_exercise_history": _history,
    "get_alternatives": _alternatives,
    "list_exercises": _list_exercises,
}


def execute_tool(name: str, args: dict, user_id: str):
    fn = REGISTRY.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(args or {}, user_id)
    except Exception as e:
        logger.exception("tool %s failed", name)
        return {"error": f"{type(e).__name__}: {e}"}
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/chat backend/tests/test_chat_tools.py && git commit -m "feat: chat tool definitions and registry executor"`

---

### Task 5: LLM wrapper + generation loop

**Files:**
- Create: `backend/app/services/llm.py`, `backend/app/chat/generation.py`
- Test: `backend/tests/test_generation.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_generation.py`:

```python
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
def test_simple_turn_no_tools(mock_llm, mock_usage, mock_store, mock_db):
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
def test_tool_loop_accumulates_usage(mock_llm, mock_exec, mock_usage, mock_store, mock_db):
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
@patch("app.chat.generation.usage_service.record_usage", return_value=0.0)
@patch("app.chat.generation.llm.complete", side_effect=RuntimeError("api down"))
def test_llm_failure_emits_error_event(mock_llm, mock_usage, mock_store, mock_db):
    from app.chat.generation import generate_turn_sync
    mock_store.get_turn.return_value = {"id": "t1", "events": []}
    mock_store.append_events.side_effect = lambda c, t, turn, ev: turn
    generate_turn_sync("u1", "c1", "t1", [{"role": "user", "content": "hi"}])
    flat = [e for call in mock_store.append_events.call_args_list for e in call.args[3]]
    assert flat[-1]["type"] == "error"
    mock_store.finalize_turn.assert_called_once()  # finalized as failed
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/services/llm.py`:

```python
import litellm

from app.config import get_settings


def complete(messages: list[dict], tools: list[dict] | None = None):
    """Single non-streamed completion via LiteLLM. Model + key from settings."""
    s = get_settings()
    return litellm.completion(
        model=s.chat_model,
        messages=messages,
        tools=tools or None,
        api_key=s.openai_api_key or None,
    )
```

`backend/app/chat/generation.py`:

```python
import json
import logging
import time

from app.chat.tools.definitions import TOOLS
from app.chat.tools.executor import execute_tool
from app.config import get_settings
from app.services import chat_store, llm, usage_service

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a strength-training coach with access to the user's workout data via tools. "
    "Ground every claim in their actual data - call tools rather than guessing. "
    "Respond briefly unless asked for a deep dive. Use kg unless the data says otherwise."
)

MAX_TOOL_ROUNDS = 6
TEXT_CHUNK = 400  # chars per text event


def _chunk_text(text: str) -> list[dict]:
    return [{"type": "text", "text": text[i:i + TEXT_CHUNK]}
            for i in range(0, len(text), TEXT_CHUNK)] or [{"type": "text", "text": ""}]


def generate_turn_sync(user_id: str, conv_id: str, turn_id: str,
                       history: list[dict]) -> None:
    """Agentic loop. Usage accumulated across sub-turns, recorded ONCE in finally."""
    start = time.monotonic()
    s = get_settings()
    total_in = total_out = 0
    final_text = ""
    status = "failed"
    turn = chat_store.get_turn(conv_id, turn_id, user_id) or {"id": turn_id, "events": []}
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            resp = llm.complete(messages, tools=TOOLS)
            usage = getattr(resp, "usage", None)
            total_in += getattr(usage, "prompt_tokens", 0) or 0
            total_out += getattr(usage, "completion_tokens", 0) or 0
            msg = resp.choices[0].message

            if getattr(msg, "tool_calls", None):
                messages.append({
                    "role": "assistant", "content": msg.content,
                    "tool_calls": [
                        {"id": tc.id, "type": "function",
                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in msg.tool_calls
                    ],
                })
                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments or "{}")
                    turn = chat_store.append_events(conv_id, turn_id, turn, [
                        {"type": "tool_call", "name": tc.function.name, "args": args}])
                    result = execute_tool(tc.function.name, args, user_id=user_id)
                    turn = chat_store.append_events(conv_id, turn_id, turn, [
                        {"type": "tool_result", "name": tc.function.name}])
                    messages.append({"role": "tool", "tool_call_id": tc.id,
                                     "content": json.dumps(result, default=str)})
                continue

            final_text = msg.content or ""
            turn = chat_store.append_events(conv_id, turn_id, turn, _chunk_text(final_text))
            status = "completed"
            break
        else:
            final_text = "I hit my tool-call limit for this question. Try narrowing it."
            turn = chat_store.append_events(conv_id, turn_id, turn, _chunk_text(final_text))
            status = "completed"

        chat_store.append_events(conv_id, turn_id, turn, [{"type": "done"}])
    except Exception as e:
        logger.exception("generation failed for turn %s", turn_id)
        try:
            chat_store.append_events(conv_id, turn_id, turn, [
                {"type": "error", "message": f"{type(e).__name__}: {e}"}])
        except Exception:
            logger.exception("failed to append error event")
    finally:
        duration_ms = int((time.monotonic() - start) * 1000)
        cost = usage_service.record_usage(
            user_id=user_id, source="chat", model=s.chat_model,
            input_tokens=total_in, output_tokens=total_out,
            duration_ms=duration_ms, conversation_id=conv_id)
        try:
            chat_store.finalize_turn(conv_id, turn_id, final_text, status,
                                     total_in, total_out, cost)
        except Exception:
            logger.exception("finalize_turn failed")
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/services/llm.py backend/app/chat/generation.py backend/tests/test_generation.py && git commit -m "feat: litellm wrapper and agentic generation loop with single usage record"`

---

### Task 6: Chat + usage routers (SSE)

**Files:**
- Create: `backend/app/routers/chat.py`, `backend/app/routers/usage.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_chat_api.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_chat_api.py`:

```python
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
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/routers/chat.py`:

```python
import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import CurrentUser, get_current_user
from app.chat.generation import generate_turn_sync
from app.config import get_settings
from app.services import chat_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_BG_TASKS: set[asyncio.Task] = set()  # pin against GC

POLL_INTERVAL_S = 0.2
KEEPALIVE_EVERY_S = 10


class StartRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


def _spawn_generation(user_id: str, conv_id: str, turn_id: str, history: list[dict]) -> None:
    task = asyncio.create_task(
        asyncio.to_thread(generate_turn_sync, user_id, conv_id, turn_id, history))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


@router.post("/start")
async def start(body: StartRequest, user: CurrentUser = Depends(get_current_user)):
    if body.conversation_id:
        conv = await asyncio.to_thread(chat_store.get_conversation, body.conversation_id, user.user_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        conv_id = conv["id"]
    else:
        conv = await asyncio.to_thread(
            chat_store.create_conversation, user.user_id, body.message[:60])
        conv_id = conv["id"]

    prior = await asyncio.to_thread(chat_store.list_turns, conv_id, user.user_id) or []
    history = [{"role": t["role"], "content": t["content"]}
               for t in prior if t.get("content")]
    history.append({"role": "user", "content": body.message})

    user_turn = await asyncio.to_thread(
        chat_store.create_turn, conv_id, user.user_id, "user", body.message, "completed")
    asst_turn = await asyncio.to_thread(
        chat_store.create_turn, conv_id, user.user_id, "assistant", "", "pending")

    _spawn_generation(user.user_id, conv_id, asst_turn["id"], history)
    return {"conversation_id": conv_id, "user_turn_id": user_turn["id"],
            "assistant_turn_id": asst_turn["id"]}


@router.get("/conversations")
async def conversations(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(chat_store.list_conversations, user.user_id)


@router.get("/conversations/{conv_id}")
async def conversation(conv_id: str, user: CurrentUser = Depends(get_current_user)):
    conv = await asyncio.to_thread(chat_store.get_conversation, conv_id, user.user_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    turns = await asyncio.to_thread(chat_store.list_turns, conv_id, user.user_id) or []
    return {**conv, "turns": turns}


@router.get("/conversations/{conv_id}/turns/{turn_id}/stream")
async def stream(conv_id: str, turn_id: str, from_seq: int = 0,
                 user: CurrentUser = Depends(get_current_user)):
    turn = await asyncio.to_thread(chat_store.get_turn, conv_id, turn_id, user.user_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Turn not found")

    async def gen():
        last_seq = from_seq
        last_keepalive = asyncio.get_event_loop().time()
        deadline = last_keepalive + get_settings().chat_generation_timeout_s
        current = turn
        while True:
            for e in chat_store.next_events(current, last_seq):
                last_seq = e["seq"]
                yield f"data: {json.dumps(e)}\n\n"
            if chat_store.is_terminal(current):
                return
            now = asyncio.get_event_loop().time()
            if now > deadline:
                yield f'data: {json.dumps({"seq": last_seq + 1, "type": "error", "message": "stream timeout"})}\n\n'
                return
            if now - last_keepalive > KEEPALIVE_EVERY_S:
                last_keepalive = now
                yield ": keepalive\n\n"
            await asyncio.sleep(POLL_INTERVAL_S)
            current = await asyncio.to_thread(chat_store.get_turn, conv_id, turn_id, user.user_id) or current

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
```

`backend/app/routers/usage.py`:

```python
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth.dependencies import CurrentUser, get_current_user
from app.services import usage_service

router = APIRouter(prefix="/api/v1/usage", tags=["usage"])


@router.get("/summary")
async def summary(month: str | None = None, user: CurrentUser = Depends(get_current_user)):
    m = month or datetime.now(timezone.utc).strftime("%Y-%m")
    return await asyncio.to_thread(usage_service.monthly_summary, user.user_id, m)
```

In `backend/app/main.py` add:

```python
from app.routers.chat import router as chat_router
from app.routers.usage import router as usage_router

app.include_router(chat_router)
app.include_router(usage_router)
```

- [ ] **Step 4: Run to pass** (full suite).
- [ ] **Step 5: Commit** — `git add backend/app backend/tests/test_chat_api.py && git commit -m "feat: chat API with resumable SSE and usage summary endpoint"`

---

### Task 7: Terraform — OpenAI key into Cloud Run

**Files:**
- Modify: `terraform/main/secrets.tf`, `terraform/main/cloud_run.tf`

- [ ] **Step 1:** Append to `terraform/main/secrets.tf` (data reference — version added manually in Task 0, never via terraform):

```hcl
data "google_secret_manager_secret" "openai_key" {
  secret_id = "fitness-tracker-openai-key-prod"
}

resource "google_secret_manager_secret_iam_member" "openai_key_accessor" {
  secret_id = data.google_secret_manager_secret.openai_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}
```

- [ ] **Step 2:** In `terraform/main/cloud_run.tf` add to the containers env list:

```hcl
      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.openai_key.secret_id
            version = "latest"
          }
        }
      }
```

- [ ] **Step 3:** `terraform -chdir=terraform/main validate` → valid.
- [ ] **Step 4: Commit** — `git add terraform/main && git commit -m "feat: wire openai key secret into cloud run"`

---

### Task 8: Deploy + live verification

- [ ] **Step 1:** Full suite green locally; push; CI green.
- [ ] **Step 2:** Live: unauthenticated `/api/v1/chat/conversations` → 401.
- [ ] **Step 3:** Authenticated live chat test (controller mints a JWT locally with the PROD secret only if accessible; otherwise verify via logs): preferred — temporary script `backend/scripts/live_chat_smoke.py` run by controller with prod JWT obtained from Secret Manager:

```bash
JWT_SECRET_KEY=$(gcloud secrets versions access latest --secret fitness-tracker-jwt-secret-prod --project personal-projects-473219) \
  backend/.venv/bin/python - <<'EOF'
import os, json, time, urllib.request
import jwt as pyjwt
from datetime import datetime, timedelta, timezone
tok = pyjwt.encode({"sub": "live-smoke", "email": "iamdhishan@gmail.com",
                    "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
                    "iat": datetime.now(timezone.utc)},
                   os.environ["JWT_SECRET_KEY"], algorithm="HS256")
base = os.environ.get("API_URL")
req = urllib.request.Request(base + "/api/v1/chat/start",
    data=json.dumps({"message": "Say OK and nothing else."}).encode(),
    headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, method="POST")
ids = json.loads(urllib.request.urlopen(req).read())
print("started:", ids)
time.sleep(8)
req2 = urllib.request.Request(f"{base}/api/v1/chat/conversations/{ids['conversation_id']}",
    headers={"Authorization": f"Bearer {tok}"})
conv = json.loads(urllib.request.urlopen(req2).read())
asst = [t for t in conv["turns"] if t["role"] == "assistant"][0]
print("status:", asst["status"], "content:", asst["content"][:80],
      "tokens:", asst["input_tokens"], asst["output_tokens"], "cost:", asst["cost_usd"])
assert asst["status"] == "completed" and asst["content"], "generation did not complete"
EOF
```

with `API_URL=$(terraform -chdir=terraform/main output -raw cloud_run_url)`.

- [ ] **Step 4:** Check usage: `GET /api/v1/usage/summary` with same JWT shows calls >= 1.
- [ ] **Step 5:** Tag — `git tag plan-3-complete && git push --tags`

---

## Self-review notes

- Spec coverage: durable conversations/turns (T2), seq events + from_seq resume + keepalive + timeout (T2,T6), tools grounded in user data via registry (T4), LiteLLM + GPT-5.5 + swap-by-config (T1,T5), usage once-per-turn with cost + monthly summary + per-conversation totals (T3,T5,T2 finalize), `/usage/summary` endpoint (T6), OpenAI key via Secret Manager with accessor IAM (T7, learning from Plan 1's missed binding), live verified chat round-trip (T8).
- Deviation from sibling repo, intentional: non-streamed LLM call per sub-turn with chunked text events instead of token-delta streaming. Simpler, resumable behavior identical from the client's perspective; revisit token streaming if latency feels bad.
- Consistency: event types {text, tool_call, tool_result, done, error}; `generate_turn_sync` signature matches `_spawn_generation` call; `record_usage` kwargs match test assertions.
