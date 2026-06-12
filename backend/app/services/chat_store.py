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
