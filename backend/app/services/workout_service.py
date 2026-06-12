from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db


def compute_total_volume(entries: list[dict]) -> float:
    return sum(
        s["weight"] * s["reps"]
        for e in entries for s in e.get("sets", [])
        if not s.get("is_warmup", False)
    )


def exercise_ids_from_entries(entries: list[dict]) -> list[str]:
    seen: list[str] = []
    for e in entries:
        if e["exercise_id"] not in seen:
            seen.append(e["exercise_id"])
    return seen


def detect_prs(entries: list[dict], history_max: dict[str, float]) -> list[dict]:
    """history_max: exercise_id -> best working-set weight before this workout."""
    prs = []
    for e in entries:
        working = [s["weight"] for s in e.get("sets", []) if not s.get("is_warmup", False)]
        if not working:
            continue
        top = max(working)
        prev = history_max.get(e["exercise_id"])
        if prev is not None and top > prev:
            prs.append({"exercise_id": e["exercise_id"], "exercise_name": e.get("exercise_name", ""),
                        "weight": top, "previous_best": prev})
    return prs


# ---- Firestore plumbing ----

def _doc(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


def create_workout(user_id: str, payload: dict) -> dict:
    db = get_db()
    entries = [e for e in payload.get("entries", [])]
    doc = {
        "user_id": user_id,
        "date": payload["date"],
        "notes": payload.get("notes", ""),
        "entries": entries,
        "exercise_ids": exercise_ids_from_entries(entries),
        "started_at": datetime.now(timezone.utc),
        "ended_at": None,
        "total_volume": 0,
    }
    ref = db.collection("workouts").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def get_workout(workout_id: str, user_id: str) -> dict | None:
    db = get_db()
    snap = db.collection("workouts").document(workout_id).get()
    if not snap.exists:
        return None
    doc = _doc(snap)
    if doc["user_id"] != user_id:
        return None
    return doc


def list_workouts(user_id: str, date_from: str | None, date_to: str | None,
                  limit: int, offset: int) -> dict:
    db = get_db()
    query = db.collection("workouts").where(filter=firestore.FieldFilter("user_id", "==", user_id))
    if date_from:
        query = query.where(filter=firestore.FieldFilter("date", ">=", date_from))
    if date_to:
        query = query.where(filter=firestore.FieldFilter("date", "<=", date_to))
    docs = [_doc(d) for d in query.order_by("date", direction=firestore.Query.DESCENDING).stream()]
    return {"items": docs[offset:offset + limit], "total": len(docs)}


def get_active_workout(user_id: str) -> dict | None:
    db = get_db()
    query = (
        db.collection("workouts")
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .where(filter=firestore.FieldFilter("ended_at", "==", None))
        .limit(1)
    )
    docs = [_doc(d) for d in query.stream()]
    return docs[0] if docs else None


def update_workout(workout_id: str, user_id: str, payload: dict) -> dict | None:
    doc = get_workout(workout_id, user_id)
    if doc is None:
        return None
    updates: dict = {}
    if payload.get("notes") is not None:
        updates["notes"] = payload["notes"]
    if payload.get("entries") is not None:
        updates["entries"] = payload["entries"]
        updates["exercise_ids"] = exercise_ids_from_entries(payload["entries"])
    if updates:
        get_db().collection("workouts").document(workout_id).update(updates)
        doc.update(updates)
    return doc


def history_max_for(user_id: str, exercise_ids: list[str], exclude_workout_id: str) -> dict[str, float]:
    best: dict[str, float] = {}
    db = get_db()
    for ex_id in exercise_ids:
        query = (
            db.collection("workouts")
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .where(filter=firestore.FieldFilter("exercise_ids", "array_contains", ex_id))
            .order_by("date", direction=firestore.Query.DESCENDING)
            .limit(50)
        )
        for d in query.stream():
            if d.id == exclude_workout_id:
                continue
            for e in d.to_dict().get("entries", []):
                if e["exercise_id"] != ex_id:
                    continue
                for s in e.get("sets", []):
                    if not s.get("is_warmup", False):
                        best[ex_id] = max(best.get(ex_id, 0.0), s["weight"])
    return best


def finish_workout(workout_id: str, user_id: str) -> dict | None:
    doc = get_workout(workout_id, user_id)
    if doc is None:
        return None
    total = compute_total_volume(doc.get("entries", []))
    hist = history_max_for(user_id, doc.get("exercise_ids", []), workout_id)
    prs = detect_prs(doc.get("entries", []), hist)
    ended = datetime.now(timezone.utc)
    get_db().collection("workouts").document(workout_id).update(
        {"ended_at": ended, "total_volume": total}
    )
    return {**doc, "ended_at": ended, "total_volume": total, "prs": prs}


def delete_workout(workout_id: str, user_id: str) -> bool:
    doc = get_workout(workout_id, user_id)
    if doc is None:
        return False
    get_db().collection("workouts").document(workout_id).delete()
    return True
