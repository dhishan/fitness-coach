from google.cloud import firestore

from app.firestore import get_db


def rank_alternatives(target: dict, pool: list[dict]) -> list[dict]:
    """Same movement pattern, ranked by primary-muscle overlap desc, then name."""
    tp = set(target["primary_muscles"])
    candidates = [
        e for e in pool
        if e["id"] != target["id"] and e["movement_pattern"] == target["movement_pattern"]
    ]
    scored = [(len(tp & set(e["primary_muscles"])), e) for e in candidates]
    scored = [(s, e) for s, e in scored if s > 0]
    scored.sort(key=lambda se: (-se[0], se[1]["name"]))
    return [e for _, e in scored]


def extract_history(exercise_id: str, workouts: list[dict]) -> list[dict]:
    """Workouts must be ordered date desc. Returns per-workout set lists for the exercise."""
    out = []
    for w in workouts:
        for entry in w.get("entries", []):
            if entry["exercise_id"] == exercise_id:
                out.append({"workout_id": w["id"], "date": w["date"], "sets": entry["sets"]})
    return out


# ---- Firestore plumbing (thin; covered by live verification + Plan 6 E2E) ----

def list_exercises(user_id: str, muscle: str | None = None,
                   pattern: str | None = None, q: str | None = None) -> list[dict]:
    db = get_db()
    docs = []
    for owner in ("system", user_id):
        query = db.collection("exercises").where(filter=firestore.FieldFilter("user_id", "==", owner))
        docs.extend({**d.to_dict(), "id": d.id} for d in query.stream())
    if muscle:
        docs = [d for d in docs if muscle in d["primary_muscles"] + d.get("secondary_muscles", [])]
    if pattern:
        docs = [d for d in docs if d["movement_pattern"] == pattern]
    if q:
        docs = [d for d in docs if q.lower() in d["name"].lower()]
    docs.sort(key=lambda d: d["name"])
    return docs


def get_exercise(exercise_id: str, user_id: str) -> dict | None:
    db = get_db()
    snap = db.collection("exercises").document(exercise_id).get()
    if not snap.exists:
        return None
    doc = {**snap.to_dict(), "id": snap.id}
    if doc["user_id"] not in ("system", user_id):
        return None  # cross-user -> behave as not-found
    return doc


def create_exercise(user_id: str, payload: dict) -> dict:
    db = get_db()
    ref = db.collection("exercises").document()
    doc = {**payload, "user_id": user_id, "is_custom": True}
    ref.set(doc)
    return {**doc, "id": ref.id}


def alternatives_for(exercise_id: str, user_id: str) -> list[dict] | None:
    target = get_exercise(exercise_id, user_id)
    if target is None:
        return None
    pool = list_exercises(user_id)
    return rank_alternatives(target, pool)


def history_for(exercise_id: str, user_id: str, limit: int = 3) -> list[dict]:
    db = get_db()
    query = (
        db.collection("workouts")
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .where(filter=firestore.FieldFilter("exercise_ids", "array_contains", exercise_id))
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    workouts = [{**d.to_dict(), "id": d.id} for d in query.stream()]
    return extract_history(exercise_id, workouts)
