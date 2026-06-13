"""Food log + favorites CRUD.

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


def _sum_macros(items: list[dict]) -> dict:
    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    for item in items:
        m = item.get("macros") or {}
        for key in totals:
            totals[key] += m.get(key, 0) or 0
    return totals


# ---- Food Logs ----

def create_log(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc = {
        "user_id": user_id,
        "date": payload["date"],
        "name": payload["name"],
        "serving": payload.get("serving", ""),
        "macros": payload["macros"],
        "source": payload.get("source", "manual"),
        "notes": payload.get("notes", ""),
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("food_logs").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def list_by_date(user_id: str, date: str) -> dict:
    db = get_db()
    snaps = (
        db.collection("food_logs")
        .where("user_id", "==", user_id)
        .where("date", "==", date)
        .stream()
    )
    items = [_doc(s) for s in snaps]
    return {"items": items, "totals": _sum_macros(items)}


def get_log(user_id: str, log_id: str) -> dict | None:
    snap = get_db().collection("food_logs").document(log_id).get()
    if not snap.exists:
        return None
    d = _doc(snap)
    if d.get("user_id") != user_id:
        return None
    return d


def update_log(user_id: str, log_id: str, updates: dict) -> dict | None:
    ref = get_db().collection("food_logs").document(log_id)
    snap = ref.get()
    if not snap.exists:
        return None
    d = snap.to_dict()
    if d.get("user_id") != user_id:
        return None
    ref.update(updates)
    return {**d, **updates, "id": log_id}


def delete_log(user_id: str, log_id: str) -> str | None:
    ref = get_db().collection("food_logs").document(log_id)
    snap = ref.get()
    if not snap.exists:
        return None
    if snap.to_dict().get("user_id") != user_id:
        return None
    ref.delete()
    return log_id


# ---- Favorites ----

def list_favorites(user_id: str) -> list[dict]:
    snaps = (
        get_db().collection("favorites")
        .where("user_id", "==", user_id)
        .order_by("last_used_at", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [_doc(s) for s in snaps]


def create_favorite(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc = {
        "user_id": user_id,
        "name": payload["name"],
        "serving": payload.get("serving", ""),
        "macros": payload["macros"],
        "last_used_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("favorites").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def delete_favorite(user_id: str, fav_id: str) -> str | None:
    ref = get_db().collection("favorites").document(fav_id)
    snap = ref.get()
    if not snap.exists:
        return None
    if snap.to_dict().get("user_id") != user_id:
        return None
    ref.delete()
    return fav_id


def log_from_favorite(user_id: str, fav_id: str, date: str) -> dict | None:
    """Clone a favorite into a food log entry for the given date."""
    db = get_db()
    fav_ref = db.collection("favorites").document(fav_id)
    snap = fav_ref.get()
    if not snap.exists:
        return None
    fav = snap.to_dict()
    if fav.get("user_id") != user_id:
        return None
    # Update last_used_at on the favorite
    now = datetime.now(timezone.utc)
    fav_ref.update({"last_used_at": now})
    # Create the food log
    log_doc = {
        "user_id": user_id,
        "date": date,
        "name": fav["name"],
        "serving": fav.get("serving", ""),
        "macros": fav["macros"],
        "source": "favorite",
        "notes": "",
        "created_at": now,
    }
    ref = db.collection("food_logs").document()
    ref.set(log_doc)
    return {**log_doc, "id": ref.id}
