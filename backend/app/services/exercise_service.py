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

# Aliases the search query gets expanded with so "chest" → matches Bench Press
# (which lists primary_muscles=[chest]) and "biceps" → matches Curls etc.
# Add freely; the keys are user-typed words, the values are tags to also try.
_SEARCH_ALIASES: dict[str, list[str]] = {
    "chest": ["chest", "push", "bench", "press", "fly", "dip"],
    "pec": ["chest"],
    "pecs": ["chest"],
    "back": ["back", "pull", "row", "pulldown", "pullup", "deadlift"],
    "lats": ["back", "pulldown", "pullup"],
    "quad": ["quads", "squat", "lunge", "leg"],
    "quads": ["quads", "squat", "lunge", "leg"],
    "leg": ["quads", "hamstrings", "glutes", "calves", "squat", "lunge", "deadlift"],
    "legs": ["quads", "hamstrings", "glutes", "calves", "squat", "lunge"],
    "hamstring": ["hamstrings", "hinge", "deadlift", "rdl", "curl"],
    "hamstrings": ["hamstrings", "hinge", "deadlift", "rdl"],
    "glute": ["glutes", "hinge", "squat", "hip"],
    "glutes": ["glutes", "hip"],
    "butt": ["glutes"],
    "shoulder": ["shoulders", "push", "press", "raise"],
    "shoulders": ["shoulders"],
    "delt": ["shoulders"],
    "delts": ["shoulders"],
    "bicep": ["biceps", "curl", "pull"],
    "biceps": ["biceps", "curl"],
    "tricep": ["triceps", "push", "pressdown", "extension"],
    "triceps": ["triceps"],
    "core": ["core", "abs", "plank", "crunch"],
    "abs": ["core", "crunch"],
    "calf": ["calves", "raise"],
    "calves": ["calves"],
    "forearm": ["forearms", "grip"],
    "cardio": ["bodyweight"],
    "bodyweight": ["bodyweight"],
    "barbell": ["barbell"],
    "dumbbell": ["dumbbell"],
    "db": ["dumbbell"],
    "bb": ["barbell"],
    "machine": ["machine"],
    "cable": ["cable"],
    "push": ["push"],
    "pull": ["pull"],
    "squat": ["squat", "quads", "glutes"],
    "hinge": ["hinge", "hamstrings", "glutes", "deadlift"],
    "carry": ["carry"],
}


def _expand_query(q: str) -> list[str]:
    """Tokenise + expand user query into search terms."""
    tokens = [t for t in q.lower().split() if t]
    expanded: list[str] = []
    for t in tokens:
        expanded.append(t)
        expanded.extend(_SEARCH_ALIASES.get(t, []))
    # de-dup preserving order
    seen, out = set(), []
    for t in expanded:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _score_exercise(doc: dict, terms: list[str]) -> int:
    """Score how well an exercise matches the expanded query terms.

    Higher = better. 0 = no match (filter out).
    """
    name = doc.get("name", "").lower()
    primary = [m.lower() for m in doc.get("primary_muscles", []) or []]
    secondary = [m.lower() for m in doc.get("secondary_muscles", []) or []]
    pattern = (doc.get("movement_pattern") or "").lower()
    equipment = (doc.get("equipment") or "").lower()
    haystack_text = f"{name} {pattern} {equipment} {' '.join(primary)} {' '.join(secondary)}"

    score = 0
    for term in terms:
        if not term:
            continue
        # Exact full name match — push to the top
        if name == term:
            score += 200
        elif name.startswith(term):
            score += 80
        # Word in the name (boundary-aware enough via simple substring on a
        # space-delimited haystack)
        if term in name.split():
            score += 60
        elif term in name:
            score += 40
        if term in primary:
            score += 50
        elif term in secondary:
            score += 20
        if term == pattern:
            score += 35
        if term == equipment:
            score += 25
        # Last-resort haystack hit so single-letter abbreviations still match
        if score == 0 and term in haystack_text:
            score += 10
    return score


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
    if q and q.strip():
        terms = _expand_query(q)
        scored = [(d, _score_exercise(d, terms)) for d in docs]
        scored = [(d, s) for d, s in scored if s > 0]
        scored.sort(key=lambda ds: (-ds[1], ds[0]["name"]))
        return [d for d, _ in scored]
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
