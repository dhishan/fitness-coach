from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db


def _doc(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


def list_templates(user_id: str) -> list[dict]:
    db = get_db()
    query = (
        db.collection("workout_templates")
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .order_by("updated_at", direction=firestore.Query.DESCENDING)
    )
    return [_doc(d) for d in query.stream()]


def get_template(template_id: str, user_id: str) -> dict | None:
    db = get_db()
    snap = db.collection("workout_templates").document(template_id).get()
    if not snap.exists:
        return None
    doc = _doc(snap)
    if doc["user_id"] != user_id:
        return None
    return doc


def create_template(user_id: str, payload: dict) -> dict:
    db = get_db()
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user_id,
        "name": payload["name"],
        "entries": payload.get("entries", []),
        "created_at": now,
        "updated_at": now,
    }
    ref = db.collection("workout_templates").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def update_template(template_id: str, user_id: str, payload: dict) -> dict | None:
    doc = get_template(template_id, user_id)
    if doc is None:
        return None
    updates: dict = {"updated_at": datetime.now(timezone.utc)}
    if payload.get("name") is not None:
        updates["name"] = payload["name"]
    if payload.get("entries") is not None:
        updates["entries"] = payload["entries"]
    get_db().collection("workout_templates").document(template_id).update(updates)
    doc.update(updates)
    return doc


def delete_template(template_id: str, user_id: str) -> bool:
    doc = get_template(template_id, user_id)
    if doc is None:
        return False
    get_db().collection("workout_templates").document(template_id).delete()
    return True
