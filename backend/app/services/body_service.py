"""Body metrics CRUD.

User isolation pattern: every read checks doc["user_id"] == uid.
Returns None when doc is missing or belongs to a different user.
Route layer translates None to 404.
"""
import logging
from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db

logger = logging.getLogger(__name__)


def _doc(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


def create_metric(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc = {
        "user_id": user_id,
        "date": payload["date"],
        "weight_kg": payload["weight_kg"],
        "body_fat_pct": payload.get("body_fat_pct"),
        "waist_cm": payload.get("waist_cm"),
        "chest_cm": payload.get("chest_cm"),
        "arm_cm": payload.get("arm_cm"),
        "thigh_cm": payload.get("thigh_cm"),
        "photo_urls": payload.get("photo_urls", []),
        "notes": payload.get("notes", ""),
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("body_metrics").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def list_metrics(user_id: str, limit: int = 90) -> list[dict]:
    db = get_db()
    snaps = (
        db.collection("body_metrics")
        .where("user_id", "==", user_id)
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    return [_doc(s) for s in snaps]


def latest_metric(user_id: str) -> dict | None:
    results = list_metrics(user_id, limit=1)
    return results[0] if results else None


def latest_weight(user_id: str) -> float | None:
    metric = latest_metric(user_id)
    if metric is None:
        return None
    return metric.get("weight_kg")


def get_metric(user_id: str, metric_id: str) -> dict | None:
    snap = get_db().collection("body_metrics").document(metric_id).get()
    if not snap.exists:
        return None
    d = _doc(snap)
    if d.get("user_id") != user_id:
        return None
    return d


def update_metric(user_id: str, metric_id: str, updates: dict) -> dict | None:
    ref = get_db().collection("body_metrics").document(metric_id)
    snap = ref.get()
    if not snap.exists:
        return None
    d = snap.to_dict()
    if d.get("user_id") != user_id:
        return None
    ref.update(updates)
    return {**d, **updates, "id": metric_id}


def delete_metric(user_id: str, metric_id: str) -> str | None:
    ref = get_db().collection("body_metrics").document(metric_id)
    snap = ref.get()
    if not snap.exists:
        return None
    if snap.to_dict().get("user_id") != user_id:
        return None
    ref.delete()
    return metric_id
