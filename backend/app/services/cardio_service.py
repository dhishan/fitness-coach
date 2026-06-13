"""Cardio logs CRUD.

User isolation pattern: every read checks doc["user_id"] == uid.
Returns None when doc is missing or belongs to a different user.
Route layer translates None to 404.

Idempotency: if external_id is provided (HealthKit UUID), query before
inserting. If a doc with the same (user_id, external_id) already exists,
return it unchanged — prevents duplicate imports.
"""
import logging
from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db

logger = logging.getLogger(__name__)


def _doc(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


def create_log(user_id: str, payload: dict) -> dict:
    db = get_db()
    external_id = payload.get("external_id")

    # Idempotency: if external_id provided, check for existing doc
    if external_id:
        existing = (
            db.collection("cardio_logs")
            .where("user_id", "==", user_id)
            .where("external_id", "==", external_id)
            .limit(1)
            .stream()
        )
        for snap in existing:
            return _doc(snap)

    doc = {
        "user_id": user_id,
        "date": payload["date"],
        "type": payload["type"],
        "duration_s": payload.get("duration_s", 0),
        "distance_m": payload.get("distance_m", 0),
        "avg_hr": payload.get("avg_hr"),
        "calories": payload.get("calories"),
        "notes": payload.get("notes", ""),
        "source": payload.get("source", "manual"),
        "external_id": external_id,
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("cardio_logs").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def list_logs(
    user_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    db = get_db()
    q = (
        db.collection("cardio_logs")
        .where("user_id", "==", user_id)
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    return [_doc(s) for s in q.stream()]


def get_log(user_id: str, log_id: str) -> dict | None:
    snap = get_db().collection("cardio_logs").document(log_id).get()
    if not snap.exists:
        return None
    d = _doc(snap)
    if d.get("user_id") != user_id:
        return None
    return d


def update_log(user_id: str, log_id: str, updates: dict) -> dict | None:
    ref = get_db().collection("cardio_logs").document(log_id)
    snap = ref.get()
    if not snap.exists:
        return None
    d = snap.to_dict()
    if d.get("user_id") != user_id:
        return None
    ref.update(updates)
    return {**d, **updates, "id": log_id}


def delete_log(user_id: str, log_id: str) -> str | None:
    ref = get_db().collection("cardio_logs").document(log_id)
    snap = ref.get()
    if not snap.exists:
        return None
    if snap.to_dict().get("user_id") != user_id:
        return None
    ref.delete()
    return log_id
