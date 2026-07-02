from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db


def compute_total_volume(entries: list[dict]) -> float:
    # weight x reps over working sets. Time-tracked sets (duration_s set) have no
    # meaningful weight x reps product, so they are excluded from volume.
    total = 0.0
    for e in entries:
        for s in e.get("sets", []):
            if s.get("is_warmup", False) or s.get("duration_s") is not None:
                continue
            total += s.get("weight", 0) * s.get("reps", 0)
    return total


def exercise_ids_from_entries(entries: list[dict]) -> list[str]:
    seen: list[str] = []
    for e in entries:
        if e["exercise_id"] not in seen:
            seen.append(e["exercise_id"])
    return seen


def detect_prs(entries: list[dict], history_best: dict[str, dict]) -> list[dict]:
    """history_best: exercise_id -> {"weight": float, "duration": float} best
    working-set values before this workout. Time-tracked entries PR on the
    longest hold; everything else PRs on the heaviest working set."""
    prs = []
    for e in entries:
        working = [s for s in e.get("sets", []) if not s.get("is_warmup", False)]
        if not working:
            continue
        prev = history_best.get(e["exercise_id"], {})
        if e.get("tracking") == "time":
            top = max((s.get("duration_s") or 0) for s in working)
            if top <= 0:
                continue
            prev_d = prev.get("duration")
            if prev_d is not None and top > prev_d:
                prs.append({"exercise_id": e["exercise_id"], "exercise_name": e.get("exercise_name", ""),
                            "duration_s": top, "previous_best_duration_s": prev_d})
        else:
            top = max(s.get("weight", 0) for s in working)
            prev_w = prev.get("weight")
            if prev_w is not None and top > prev_w:
                prs.append({"exercise_id": e["exercise_id"], "exercise_name": e.get("exercise_name", ""),
                            "weight": top, "previous_best": prev_w})
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
        "intent": payload.get("intent") or None,
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
    if payload.get("intent") is not None:
        updates["intent"] = payload["intent"]
    if updates:
        get_db().collection("workouts").document(workout_id).update(updates)
        doc.update(updates)
    return doc


def history_max_for(user_id: str, exercise_ids: list[str], exclude_workout_id: str) -> dict[str, dict]:
    """exercise_id -> {"weight": best working weight, "duration": best working
    hold} across prior workouts. Only the key relevant to the exercise's
    tracking type is populated in practice."""
    best: dict[str, dict] = {}
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
                    if s.get("is_warmup", False):
                        continue
                    b = best.setdefault(ex_id, {})
                    if s.get("duration_s") is not None:
                        b["duration"] = max(b.get("duration", 0.0), s["duration_s"])
                    else:
                        b["weight"] = max(b.get("weight", 0.0), s.get("weight", 0))
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
