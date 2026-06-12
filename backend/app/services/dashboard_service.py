from datetime import date, timedelta

from google.cloud import firestore

from app.firestore import get_db
from app.services.workout_service import compute_total_volume


def _parse(d: str) -> date:
    return date.fromisoformat(d)


def week_dates(reference_date: str) -> list[str]:
    ref = _parse(reference_date)
    monday = ref - timedelta(days=ref.weekday())
    return [(monday + timedelta(days=i)).isoformat() for i in range(7)]


def streak_weeks(workout_dates: list[str], reference_date: str) -> int:
    if not workout_dates:
        return 0
    weeks = {(_parse(d).isocalendar().year, _parse(d).isocalendar().week) for d in workout_dates}
    ref = _parse(reference_date)
    streak = 0
    cursor = ref
    while (cursor.isocalendar().year, cursor.isocalendar().week) in weeks:
        streak += 1
        cursor = cursor - timedelta(days=7)
    return streak


def exercise_series(exercise_id: str, workouts: list[dict]) -> list[dict]:
    """workouts ordered date asc. Per-date top working-set weight + exercise volume."""
    out = []
    for w in workouts:
        weights, volume = [], 0.0
        for e in w.get("entries", []):
            if e["exercise_id"] != exercise_id:
                continue
            for s in e.get("sets", []):
                if s.get("is_warmup", False):
                    continue
                weights.append(s["weight"])
                volume += s["weight"] * s["reps"]
        if weights:
            out.append({"date": w["date"], "top_weight": max(weights), "volume": volume})
    return out


def muscle_split(workouts: list[dict], exercise_map: dict[str, dict]) -> dict[str, float]:
    split: dict[str, float] = {}
    for w in workouts:
        for e in w.get("entries", []):
            ex = exercise_map.get(e["exercise_id"])
            if not ex:
                continue
            vol = sum(s["weight"] * s["reps"] for s in e.get("sets", [])
                      if not s.get("is_warmup", False))
            primaries = ex.get("primary_muscles", [])
            if not primaries or vol == 0:
                continue
            share = vol / len(primaries)
            for m in primaries:
                split[m] = split.get(m, 0.0) + share
    return split


# ---- Firestore plumbing ----

def _workouts_between(user_id: str, date_from: str, date_to: str) -> list[dict]:
    db = get_db()
    query = (
        db.collection("workouts")
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .where(filter=firestore.FieldFilter("date", ">=", date_from))
        .where(filter=firestore.FieldFilter("date", "<=", date_to))
        .order_by("date")
    )
    return [{**d.to_dict(), "id": d.id} for d in query.stream()]


def summary(user_id: str, reference_date: str) -> dict:
    wd = week_dates(reference_date)
    week_workouts = _workouts_between(user_id, wd[0], wd[-1])
    db = get_db()
    recent = (
        db.collection("workouts")
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(120)
    )
    all_dates = [d.to_dict()["date"] for d in recent.stream()]
    return {
        "week_start": wd[0],
        "sessions_this_week": len(week_workouts),
        "trained_dates": sorted({w["date"] for w in week_workouts}),
        "week_volume": sum(compute_total_volume(w.get("entries", [])) for w in week_workouts),
        "streak_weeks": streak_weeks(all_dates, reference_date),
    }


def exercise_progress(user_id: str, exercise_id: str) -> list[dict]:
    db = get_db()
    query = (
        db.collection("workouts")
        .where(filter=firestore.FieldFilter("user_id", "==", user_id))
        .where(filter=firestore.FieldFilter("exercise_ids", "array_contains", exercise_id))
        .order_by("date")
    )
    workouts = [{**d.to_dict(), "id": d.id} for d in query.stream()]
    return exercise_series(exercise_id, workouts)


def muscle_split_for(user_id: str, reference_date: str, weeks: int) -> dict[str, float]:
    end = _parse(reference_date)
    start = end - timedelta(weeks=weeks)
    workouts = _workouts_between(user_id, start.isoformat(), end.isoformat())
    db = get_db()
    ex_map = {d.id: d.to_dict() for d in db.collection("exercises").stream()}
    return muscle_split(workouts, ex_map)
