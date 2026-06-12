# Plan 2: Backend Core (Exercises, Workouts, Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full strength-tracking API: exercise catalog (seeded + custom + alternatives + history), workout CRUD with autosave/finish/resume, and dashboard endpoints (summary/streak/PRs, per-exercise progress, muscle split) — deployed and verified live.

**Architecture:** Thin routers call sync service functions via `asyncio.to_thread`. Pure-logic functions (volume, alternatives ranking, streaks, series, split) are separated from Firestore plumbing and unit-tested directly; Firestore plumbing is thin and exercised by router tests with mocked services + live verification (full E2E in Plan 6). All docs denormalize `user_id`; workouts embed sets and carry a flat `exercise_ids` array.

**Tech Stack:** FastAPI, google-cloud-firestore (named DB via `app.firestore.get_db`), pytest.

**Existing foundation (Plan 1):** `app/config.py` (get_settings), `app/firestore.py` (get_db), `app/auth/dependencies.py` (`get_current_user` -> `CurrentUser(user_id, email)`), `app/main.py`, tests/conftest.py (`client`, `mock_db` fixtures).

---

### Task 1: Schemas

**Files:**
- Create: `backend/app/schemas.py`
- Test: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write failing test** — `backend/tests/test_schemas.py`:

```python
import pytest
from pydantic import ValidationError


def test_exercise_create_validates_muscles_and_pattern():
    from app.schemas import ExerciseCreate
    e = ExerciseCreate(name="Bench Press", primary_muscles=["chest", "triceps"],
                       movement_pattern="push", equipment="barbell")
    assert e.secondary_muscles == []
    with pytest.raises(ValidationError):
        ExerciseCreate(name="X", primary_muscles=["wings"], movement_pattern="push", equipment="barbell")
    with pytest.raises(ValidationError):
        ExerciseCreate(name="X", primary_muscles=["chest"], movement_pattern="yeet", equipment="barbell")


def test_workout_entry_defaults():
    from app.schemas import WorkoutEntry, SetEntry
    w = WorkoutEntry(exercise_id="e1", exercise_name="Bench Press",
                     sets=[SetEntry(weight=80, reps=5)])
    assert w.superset_group is None
    assert w.sets[0].is_warmup is False
    assert w.sets[0].rpe is None
```

- [ ] **Step 2: Run to fail** — `cd backend && .venv/bin/pytest tests/test_schemas.py -v` → ModuleNotFoundError

- [ ] **Step 3: Implement** — `backend/app/schemas.py`:

```python
from typing import Literal

from pydantic import BaseModel, Field

Muscle = Literal[
    "chest", "back", "quads", "hamstrings", "glutes", "shoulders",
    "biceps", "triceps", "core", "calves", "forearms",
]
MovementPattern = Literal["push", "pull", "squat", "hinge", "carry", "core"]
Equipment = Literal["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"]


class ExerciseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    primary_muscles: list[Muscle] = Field(min_length=1)
    secondary_muscles: list[Muscle] = []
    movement_pattern: MovementPattern
    equipment: Equipment


class Exercise(ExerciseCreate):
    id: str
    user_id: str
    is_custom: bool


class SetEntry(BaseModel):
    weight: float = Field(ge=0)
    reps: int = Field(ge=0)
    rpe: float | None = Field(default=None, ge=1, le=10)
    is_warmup: bool = False


class WorkoutEntry(BaseModel):
    exercise_id: str
    exercise_name: str
    superset_group: str | None = None
    sets: list[SetEntry] = []


class WorkoutCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str = ""
    entries: list[WorkoutEntry] = []


class WorkoutUpdate(BaseModel):
    notes: str | None = None
    entries: list[WorkoutEntry] | None = None
```

- [ ] **Step 4: Run to pass** — `cd backend && .venv/bin/pytest -q` → all green
- [ ] **Step 5: Commit** — `git add backend/app/schemas.py backend/tests/test_schemas.py && git commit -m "feat: pydantic schemas for exercises and workouts"`

---

### Task 2: Exercise seed catalog

**Files:**
- Create: `backend/app/seed/__init__.py` (empty), `backend/app/seed/exercises.py`, `backend/scripts/seed_exercises.py`
- Modify: `Makefile`
- Test: `backend/tests/test_seed.py`

- [ ] **Step 1: Failing test** — `backend/tests/test_seed.py`:

```python
def test_seed_catalog_shape():
    from app.seed.exercises import SEED_EXERCISES
    from app.schemas import ExerciseCreate
    assert len(SEED_EXERCISES) >= 24
    ids = [e["id"] for e in SEED_EXERCISES]
    assert len(ids) == len(set(ids)), "ids must be unique and stable"
    for e in SEED_EXERCISES:
        assert e["id"].startswith("sys-")
        ExerciseCreate(**{k: v for k, v in e.items() if k != "id"})  # validates
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/seed/exercises.py` (stable ids so re-seeding is idempotent):

```python
SEED_EXERCISES = [
    {"id": "sys-bench-press", "name": "Barbell Bench Press", "primary_muscles": ["chest", "triceps"], "secondary_muscles": ["shoulders"], "movement_pattern": "push", "equipment": "barbell"},
    {"id": "sys-incline-db-press", "name": "Incline Dumbbell Press", "primary_muscles": ["chest", "shoulders"], "secondary_muscles": ["triceps"], "movement_pattern": "push", "equipment": "dumbbell"},
    {"id": "sys-overhead-press", "name": "Overhead Press", "primary_muscles": ["shoulders", "triceps"], "secondary_muscles": ["core"], "movement_pattern": "push", "equipment": "barbell"},
    {"id": "sys-db-shoulder-press", "name": "Dumbbell Shoulder Press", "primary_muscles": ["shoulders"], "secondary_muscles": ["triceps"], "movement_pattern": "push", "equipment": "dumbbell"},
    {"id": "sys-dips", "name": "Dips", "primary_muscles": ["chest", "triceps"], "secondary_muscles": ["shoulders"], "movement_pattern": "push", "equipment": "bodyweight"},
    {"id": "sys-pushup", "name": "Push-Up", "primary_muscles": ["chest", "triceps"], "secondary_muscles": ["core"], "movement_pattern": "push", "equipment": "bodyweight"},
    {"id": "sys-cable-fly", "name": "Cable Fly", "primary_muscles": ["chest"], "secondary_muscles": [], "movement_pattern": "push", "equipment": "cable"},
    {"id": "sys-lateral-raise", "name": "Lateral Raise", "primary_muscles": ["shoulders"], "secondary_muscles": [], "movement_pattern": "push", "equipment": "dumbbell"},
    {"id": "sys-triceps-pushdown", "name": "Triceps Pushdown", "primary_muscles": ["triceps"], "secondary_muscles": [], "movement_pattern": "push", "equipment": "cable"},
    {"id": "sys-deadlift", "name": "Deadlift", "primary_muscles": ["hamstrings", "glutes", "back"], "secondary_muscles": ["forearms", "core"], "movement_pattern": "hinge", "equipment": "barbell"},
    {"id": "sys-romanian-deadlift", "name": "Romanian Deadlift", "primary_muscles": ["hamstrings", "glutes"], "secondary_muscles": ["back"], "movement_pattern": "hinge", "equipment": "barbell"},
    {"id": "sys-hip-thrust", "name": "Hip Thrust", "primary_muscles": ["glutes"], "secondary_muscles": ["hamstrings"], "movement_pattern": "hinge", "equipment": "barbell"},
    {"id": "sys-leg-curl", "name": "Leg Curl", "primary_muscles": ["hamstrings"], "secondary_muscles": [], "movement_pattern": "hinge", "equipment": "machine"},
    {"id": "sys-back-squat", "name": "Barbell Back Squat", "primary_muscles": ["quads", "glutes"], "secondary_muscles": ["hamstrings", "core"], "movement_pattern": "squat", "equipment": "barbell"},
    {"id": "sys-front-squat", "name": "Front Squat", "primary_muscles": ["quads", "core"], "secondary_muscles": ["glutes"], "movement_pattern": "squat", "equipment": "barbell"},
    {"id": "sys-leg-press", "name": "Leg Press", "primary_muscles": ["quads", "glutes"], "secondary_muscles": ["hamstrings"], "movement_pattern": "squat", "equipment": "machine"},
    {"id": "sys-goblet-squat", "name": "Goblet Squat", "primary_muscles": ["quads", "glutes"], "secondary_muscles": ["core"], "movement_pattern": "squat", "equipment": "dumbbell"},
    {"id": "sys-lunge", "name": "Walking Lunge", "primary_muscles": ["quads", "glutes"], "secondary_muscles": ["hamstrings"], "movement_pattern": "squat", "equipment": "dumbbell"},
    {"id": "sys-leg-extension", "name": "Leg Extension", "primary_muscles": ["quads"], "secondary_muscles": [], "movement_pattern": "squat", "equipment": "machine"},
    {"id": "sys-calf-raise", "name": "Standing Calf Raise", "primary_muscles": ["calves"], "secondary_muscles": [], "movement_pattern": "squat", "equipment": "machine"},
    {"id": "sys-pullup", "name": "Pull-Up", "primary_muscles": ["back", "biceps"], "secondary_muscles": ["forearms"], "movement_pattern": "pull", "equipment": "bodyweight"},
    {"id": "sys-lat-pulldown", "name": "Lat Pulldown", "primary_muscles": ["back", "biceps"], "secondary_muscles": [], "movement_pattern": "pull", "equipment": "cable"},
    {"id": "sys-barbell-row", "name": "Barbell Row", "primary_muscles": ["back"], "secondary_muscles": ["biceps", "forearms"], "movement_pattern": "pull", "equipment": "barbell"},
    {"id": "sys-db-row", "name": "One-Arm Dumbbell Row", "primary_muscles": ["back"], "secondary_muscles": ["biceps"], "movement_pattern": "pull", "equipment": "dumbbell"},
    {"id": "sys-seated-cable-row", "name": "Seated Cable Row", "primary_muscles": ["back"], "secondary_muscles": ["biceps"], "movement_pattern": "pull", "equipment": "cable"},
    {"id": "sys-face-pull", "name": "Face Pull", "primary_muscles": ["shoulders", "back"], "secondary_muscles": [], "movement_pattern": "pull", "equipment": "cable"},
    {"id": "sys-barbell-curl", "name": "Barbell Curl", "primary_muscles": ["biceps"], "secondary_muscles": ["forearms"], "movement_pattern": "pull", "equipment": "barbell"},
    {"id": "sys-db-curl", "name": "Dumbbell Curl", "primary_muscles": ["biceps"], "secondary_muscles": ["forearms"], "movement_pattern": "pull", "equipment": "dumbbell"},
    {"id": "sys-farmers-carry", "name": "Farmer's Carry", "primary_muscles": ["forearms", "core"], "secondary_muscles": ["shoulders"], "movement_pattern": "carry", "equipment": "dumbbell"},
    {"id": "sys-plank", "name": "Plank", "primary_muscles": ["core"], "secondary_muscles": [], "movement_pattern": "core", "equipment": "bodyweight"},
    {"id": "sys-hanging-leg-raise", "name": "Hanging Leg Raise", "primary_muscles": ["core"], "secondary_muscles": ["forearms"], "movement_pattern": "core", "equipment": "bodyweight"},
    {"id": "sys-cable-crunch", "name": "Cable Crunch", "primary_muscles": ["core"], "secondary_muscles": [], "movement_pattern": "core", "equipment": "cable"},
]
```

`backend/scripts/seed_exercises.py`:

```python
"""Idempotently seed the system exercise catalog. Safe to re-run."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.firestore import get_db
from app.seed.exercises import SEED_EXERCISES


def main() -> None:
    db = get_db()
    batch = db.batch()
    for e in SEED_EXERCISES:
        doc = {k: v for k, v in e.items() if k != "id"}
        doc["user_id"] = "system"
        doc["is_custom"] = False
        batch.set(db.collection("exercises").document(e["id"]), doc)
    batch.commit()
    print(f"Seeded {len(SEED_EXERCISES)} exercises")


if __name__ == "__main__":
    main()
```

Add Makefile target:

```makefile
seed-exercises: ## seed system exercise catalog (uses ADC; set FIRESTORE_DATABASE)
	cd backend && .venv/bin/python scripts/seed_exercises.py
```

- [ ] **Step 4: Run to pass** — full suite green.
- [ ] **Step 5: Commit** — `git add backend/app/seed backend/scripts Makefile backend/tests/test_seed.py && git commit -m "feat: system exercise seed catalog and idempotent seed script"`

---

### Task 3: Exercise service (pure logic + plumbing)

**Files:**
- Create: `backend/app/services/__init__.py` (empty), `backend/app/services/exercise_service.py`
- Test: `backend/tests/test_exercise_service.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_exercise_service.py`:

```python
def _ex(id, pattern, primary, equipment="barbell"):
    return {"id": id, "name": id, "movement_pattern": pattern,
            "primary_muscles": primary, "secondary_muscles": [], "equipment": equipment,
            "user_id": "system", "is_custom": False}


def test_rank_alternatives_same_pattern_and_overlap_first():
    from app.services.exercise_service import rank_alternatives
    target = _ex("bench", "push", ["chest", "triceps"])
    pool = [
        _ex("bench", "push", ["chest", "triceps"]),          # self - excluded
        _ex("incline-db", "push", ["chest", "shoulders"], "dumbbell"),  # overlap 1, same pattern
        _ex("dips", "push", ["chest", "triceps"], "bodyweight"),        # overlap 2, same pattern
        _ex("row", "pull", ["back"]),                                    # different pattern - excluded
        _ex("ohp", "push", ["shoulders", "triceps"]),                    # overlap 1
    ]
    ranked = rank_alternatives(target, pool)
    assert [e["id"] for e in ranked][:2] == ["dips", "incline-db"] or \
           [e["id"] for e in ranked][0] == "dips"
    assert all(e["id"] != "bench" for e in ranked)
    assert all(e["movement_pattern"] == "push" for e in ranked)


def test_extract_exercise_history():
    from app.services.exercise_service import extract_history
    workouts = [
        {"id": "w2", "date": "2026-06-10", "entries": [
            {"exercise_id": "bench", "sets": [{"weight": 82.5, "reps": 5, "is_warmup": False}]},
            {"exercise_id": "squat", "sets": [{"weight": 100, "reps": 5, "is_warmup": False}]},
        ]},
        {"id": "w1", "date": "2026-06-07", "entries": [
            {"exercise_id": "bench", "sets": [{"weight": 80, "reps": 5, "is_warmup": False}]},
        ]},
    ]
    h = extract_history("bench", workouts)
    assert len(h) == 2
    assert h[0]["workout_id"] == "w2" and h[0]["date"] == "2026-06-10"
    assert h[0]["sets"][0]["weight"] == 82.5
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/services/exercise_service.py`:

```python
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
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/services backend/tests/test_exercise_service.py && git commit -m "feat: exercise service with alternatives ranking and history extraction"`

---

### Task 4: Exercise router

**Files:**
- Create: `backend/app/routers/__init__.py` (empty), `backend/app/routers/exercises.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_exercises_api.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_exercises_api.py`:

```python
from unittest.mock import patch


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_exercises_requires_auth(client):
    assert client.get("/api/v1/exercises").status_code == 401


def test_list_exercises(client):
    with patch("app.routers.exercises.exercise_service.list_exercises", return_value=[{"id": "sys-bench-press", "name": "Barbell Bench Press"}]) as m:
        r = client.get("/api/v1/exercises?muscle=chest", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["id"] == "sys-bench-press"
    m.assert_called_once_with("u1", muscle="chest", pattern=None, q=None)


def test_create_custom_exercise(client):
    payload = {"name": "Zercher Squat", "primary_muscles": ["quads", "core"],
               "movement_pattern": "squat", "equipment": "barbell"}
    with patch("app.routers.exercises.exercise_service.create_exercise", return_value={**payload, "secondary_muscles": [], "id": "x1", "user_id": "u1", "is_custom": True}):
        r = client.post("/api/v1/exercises", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["is_custom"] is True


def test_alternatives_404_when_unknown(client):
    with patch("app.routers.exercises.exercise_service.alternatives_for", return_value=None):
        r = client.get("/api/v1/exercises/nope/alternatives", headers=_auth(client))
    assert r.status_code == 404


def test_history(client):
    with patch("app.routers.exercises.exercise_service.history_for", return_value=[{"workout_id": "w1", "date": "2026-06-10", "sets": []}]):
        r = client.get("/api/v1/exercises/sys-bench-press/history", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["workout_id"] == "w1"
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/routers/exercises.py`:

```python
import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import Exercise, ExerciseCreate
from app.services import exercise_service

router = APIRouter(prefix="/api/v1/exercises", tags=["exercises"])


@router.get("")
async def list_exercises(muscle: str | None = None, pattern: str | None = None,
                         q: str | None = None,
                         user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        exercise_service.list_exercises, user.user_id, muscle=muscle, pattern=pattern, q=q
    )


@router.post("", status_code=201, response_model=Exercise)
async def create_exercise(body: ExerciseCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        exercise_service.create_exercise, user.user_id, body.model_dump()
    )


@router.get("/{exercise_id}/alternatives")
async def alternatives(exercise_id: str, user: CurrentUser = Depends(get_current_user)):
    result = await asyncio.to_thread(exercise_service.alternatives_for, exercise_id, user.user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return result


@router.get("/{exercise_id}/history")
async def history(exercise_id: str, limit: int = 3,
                  user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        exercise_service.history_for, exercise_id, user.user_id, limit
    )
```

In `backend/app/main.py` add with the other router import/include:

```python
from app.routers.exercises import router as exercises_router

app.include_router(exercises_router)
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app backend/tests/test_exercises_api.py && git commit -m "feat: exercises API (list, create custom, alternatives, history)"`

---

### Task 5: Workout service

**Files:**
- Create: `backend/app/services/workout_service.py`
- Test: `backend/tests/test_workout_service.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_workout_service.py`:

```python
def test_compute_total_volume_skips_warmups():
    from app.services.workout_service import compute_total_volume
    entries = [
        {"exercise_id": "bench", "sets": [
            {"weight": 60, "reps": 10, "is_warmup": True},
            {"weight": 80, "reps": 5, "is_warmup": False},
            {"weight": 80, "reps": 5, "is_warmup": False},
        ]},
        {"exercise_id": "squat", "sets": [{"weight": 100, "reps": 5, "is_warmup": False}]},
    ]
    assert compute_total_volume(entries) == 80 * 5 * 2 + 100 * 5


def test_exercise_ids_from_entries():
    from app.services.workout_service import exercise_ids_from_entries
    entries = [{"exercise_id": "a", "sets": []}, {"exercise_id": "b", "sets": []},
               {"exercise_id": "a", "sets": []}]
    assert exercise_ids_from_entries(entries) == ["a", "b"]


def test_detect_prs():
    from app.services.workout_service import detect_prs
    entries = [{"exercise_id": "bench", "exercise_name": "Bench", "sets": [
        {"weight": 90, "reps": 3, "is_warmup": False}]}]
    history_max = {"bench": 85.0}
    prs = detect_prs(entries, history_max)
    assert prs == [{"exercise_id": "bench", "exercise_name": "Bench",
                    "weight": 90, "previous_best": 85.0}]
    assert detect_prs(entries, {"bench": 95.0}) == []
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/services/workout_service.py`:

```python
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
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/services/workout_service.py backend/tests/test_workout_service.py && git commit -m "feat: workout service with volume, PR detection, CRUD plumbing"`

---

### Task 6: Workout router

**Files:**
- Create: `backend/app/routers/workouts.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_workouts_api.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_workouts_api.py`:

```python
from unittest.mock import patch

BASE = "app.routers.workouts.workout_service"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_create_workout(client):
    payload = {"date": "2026-06-12", "entries": []}
    with patch(f"{BASE}.create_workout", return_value={"id": "w1", "user_id": "u1", **payload,
               "exercise_ids": [], "started_at": None, "ended_at": None, "notes": "", "total_volume": 0}):
        r = client.post("/api/v1/workouts", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "w1"


def test_create_workout_rejects_bad_date(client):
    r = client.post("/api/v1/workouts", json={"date": "12-06-2026"}, headers=_auth(client))
    assert r.status_code == 422


def test_active_returns_null_when_none(client):
    with patch(f"{BASE}.get_active_workout", return_value=None):
        r = client.get("/api/v1/workouts/active", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() is None


def test_get_workout_404_cross_user(client):
    with patch(f"{BASE}.get_workout", return_value=None):
        r = client.get("/api/v1/workouts/other", headers=_auth(client))
    assert r.status_code == 404


def test_update_workout(client):
    upd = {"entries": [{"exercise_id": "e1", "exercise_name": "Bench",
                        "sets": [{"weight": 80, "reps": 5}]}]}
    with patch(f"{BASE}.update_workout", return_value={"id": "w1", **upd}) as m:
        r = client.put("/api/v1/workouts/w1", json=upd, headers=_auth(client))
    assert r.status_code == 200
    args = m.call_args.args
    assert args[0] == "w1" and args[1] == "u1"


def test_finish_returns_prs(client):
    with patch(f"{BASE}.finish_workout", return_value={"id": "w1", "total_volume": 900, "prs": []}):
        r = client.post("/api/v1/workouts/w1/finish", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["total_volume"] == 900


def test_list_returns_total(client):
    with patch(f"{BASE}.list_workouts", return_value={"items": [], "total": 0}):
        r = client.get("/api/v1/workouts?from=2026-06-01&to=2026-06-30", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0}


def test_delete(client):
    with patch(f"{BASE}.delete_workout", return_value=True):
        assert client.delete("/api/v1/workouts/w1", headers=_auth(client)).status_code == 204
    with patch(f"{BASE}.delete_workout", return_value=False):
        assert client.delete("/api/v1/workouts/w1", headers=_auth(client)).status_code == 404
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/routers/workouts.py`:

```python
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import WorkoutCreate, WorkoutUpdate
from app.services import workout_service

router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"])


@router.post("", status_code=201)
async def create_workout(body: WorkoutCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        workout_service.create_workout, user.user_id, body.model_dump()
    )


@router.get("/active")
async def active_workout(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(workout_service.get_active_workout, user.user_id)


@router.get("")
async def list_workouts(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=20, le=100),
    offset: int = 0,
    user: CurrentUser = Depends(get_current_user),
):
    return await asyncio.to_thread(
        workout_service.list_workouts, user.user_id, date_from, date_to, limit, offset
    )


@router.get("/{workout_id}")
async def get_workout(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(workout_service.get_workout, workout_id, user.user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    return doc


@router.put("/{workout_id}")
async def update_workout(workout_id: str, body: WorkoutUpdate,
                         user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(
        workout_service.update_workout, workout_id, user.user_id, body.model_dump()
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    return doc


@router.post("/{workout_id}/finish")
async def finish_workout(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(workout_service.finish_workout, workout_id, user.user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    return doc


@router.delete("/{workout_id}", status_code=204)
async def delete_workout(workout_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(workout_service.delete_workout, workout_id, user.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workout not found")
    return Response(status_code=204)
```

NOTE: `/active` route MUST be declared before `/{workout_id}` or FastAPI matches "active" as an id.

In `backend/app/main.py`:

```python
from app.routers.workouts import router as workouts_router

app.include_router(workouts_router)
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app backend/tests/test_workouts_api.py && git commit -m "feat: workouts API (create, list, active, autosave update, finish with PRs, delete)"`

---

### Task 7: Dashboard service

**Files:**
- Create: `backend/app/services/dashboard_service.py`
- Test: `backend/tests/test_dashboard_service.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_dashboard_service.py`:

```python
def _w(date, entries=None, volume=0.0):
    return {"id": f"w-{date}", "date": date, "entries": entries or [], "total_volume": volume}


def test_week_dates_iso():
    from app.services.dashboard_service import week_dates
    # 2026-06-12 is a Friday; ISO week starts Monday 2026-06-08
    assert week_dates("2026-06-12")[0] == "2026-06-08"
    assert len(week_dates("2026-06-12")) == 7


def test_streak_weeks_counts_consecutive():
    from app.services.dashboard_service import streak_weeks
    dates = ["2026-06-10", "2026-06-03", "2026-05-27"]  # 3 consecutive ISO weeks
    assert streak_weeks(dates, reference_date="2026-06-12") == 3
    assert streak_weeks([], reference_date="2026-06-12") == 0
    # gap week breaks the streak
    assert streak_weeks(["2026-06-10", "2026-05-20"], reference_date="2026-06-12") == 1


def test_exercise_series_top_set_and_volume():
    from app.services.dashboard_service import exercise_series
    workouts = [
        _w("2026-06-01", [{"exercise_id": "bench", "sets": [
            {"weight": 80, "reps": 5, "is_warmup": False},
            {"weight": 85, "reps": 3, "is_warmup": False}]}]),
        _w("2026-06-08", [{"exercise_id": "bench", "sets": [
            {"weight": 87.5, "reps": 2, "is_warmup": False}]}]),
    ]
    series = exercise_series("bench", workouts)
    assert series == [
        {"date": "2026-06-01", "top_weight": 85, "volume": 80 * 5 + 85 * 3},
        {"date": "2026-06-08", "top_weight": 87.5, "volume": 87.5 * 2},
    ]


def test_muscle_split():
    from app.services.dashboard_service import muscle_split
    workouts = [_w("2026-06-10", [
        {"exercise_id": "bench", "sets": [{"weight": 100, "reps": 10, "is_warmup": False}]},
    ])]
    ex_map = {"bench": {"primary_muscles": ["chest", "triceps"]}}
    split = muscle_split(workouts, ex_map)
    # 1000 volume split evenly across 2 primary muscles
    assert split == {"chest": 500.0, "triceps": 500.0}
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/services/dashboard_service.py`:

```python
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
```

- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git add backend/app/services/dashboard_service.py backend/tests/test_dashboard_service.py && git commit -m "feat: dashboard service (week summary, streaks, exercise series, muscle split)"`

---

### Task 8: Dashboard router

**Files:**
- Create: `backend/app/routers/dashboard.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_dashboard_api.py`

- [ ] **Step 1: Failing tests** — `backend/tests/test_dashboard_api.py`:

```python
from unittest.mock import patch

BASE = "app.routers.dashboard.dashboard_service"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_summary_passes_reference_date(client):
    with patch(f"{BASE}.summary", return_value={"sessions_this_week": 2}) as m:
        r = client.get("/api/v1/dashboard/summary?reference_date=2026-06-12", headers=_auth(client))
    assert r.status_code == 200
    m.assert_called_once_with("u1", "2026-06-12")


def test_summary_defaults_to_today(client):
    with patch(f"{BASE}.summary", return_value={}) as m:
        client.get("/api/v1/dashboard/summary", headers=_auth(client))
    ref = m.call_args.args[1]
    assert len(ref) == 10 and ref[4] == "-"


def test_exercise_progress(client):
    with patch(f"{BASE}.exercise_progress", return_value=[{"date": "2026-06-01", "top_weight": 80, "volume": 400}]):
        r = client.get("/api/v1/dashboard/exercise/sys-bench-press", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["top_weight"] == 80


def test_muscle_split(client):
    with patch(f"{BASE}.muscle_split_for", return_value={"chest": 500.0}) as m:
        r = client.get("/api/v1/dashboard/muscle-split?weeks=4&reference_date=2026-06-12", headers=_auth(client))
    assert r.status_code == 200
    m.assert_called_once_with("u1", "2026-06-12", 4)
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement** — `backend/app/routers/dashboard.py`:

```python
import asyncio
from datetime import date

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import CurrentUser, get_current_user
from app.services import dashboard_service

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


def _ref(reference_date: str | None) -> str:
    # Client sends its LOCAL date; server falls back to UTC today only if absent.
    return reference_date or date.today().isoformat()


@router.get("/summary")
async def summary(reference_date: str | None = None,
                  user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(dashboard_service.summary, user.user_id, _ref(reference_date))


@router.get("/exercise/{exercise_id}")
async def exercise_progress(exercise_id: str, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(dashboard_service.exercise_progress, user.user_id, exercise_id)


@router.get("/muscle-split")
async def muscle_split(weeks: int = Query(default=4, ge=1, le=52),
                       reference_date: str | None = None,
                       user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        dashboard_service.muscle_split_for, user.user_id, _ref(reference_date), weeks
    )
```

In `backend/app/main.py`:

```python
from app.routers.dashboard import router as dashboard_router

app.include_router(dashboard_router)
```

- [ ] **Step 4: Run to pass** (full suite).
- [ ] **Step 5: Commit** — `git add backend/app backend/tests/test_dashboard_api.py && git commit -m "feat: dashboard API (summary, exercise progress, muscle split)"`

---

### Task 9: Deploy + live verification

**Files:** none new

- [ ] **Step 1: Full local suite green** — `cd backend && .venv/bin/pytest -q`
- [ ] **Step 2: Push and watch CI** — `git push && gh run watch --repo dhishan/fitness-coach --exit-status <run-id>` → all jobs green
- [ ] **Step 3: Seed prod catalog** — `FIRESTORE_DATABASE=fitness-tracker-dev GCP_PROJECT=personal-projects-473219 make seed-exercises` → "Seeded N exercises"
- [ ] **Step 4: Live smoke (no real Google token yet)**:

```bash
URL=$(terraform -chdir=terraform/main output -raw cloud_run_url)
curl -s -o /dev/null -w "%{http_code}\n" "$URL/api/v1/exercises"        # 401 (auth gate works)
curl -s -o /dev/null -w "%{http_code}\n" "$URL/api/v1/workouts/active"  # 401
curl -fsS "$URL/health"                                                  # ok
```

A full authenticated live exercise happens in Plan 6 (E2E) and Plan 4 (web login).

- [ ] **Step 5: Tag** — `git tag plan-2-complete && git push --tags`

---

## Self-review notes

- Spec coverage: exercises list/create/alternatives/history (T3-4), workouts CRUD + active + autosave PUT + finish-with-PRs + delete + list-with-total (T5-6), dashboard summary/streak/series/muscle-split with reference_date (T7-8), seeded catalog with real operator vocabulary (T2), honest 404-not-403 cross-user behavior (get_* return None -> 404).
- Route-order gotcha (`/active` before `/{workout_id}`) called out explicitly.
- Types consistent: service function signatures match router call sites and test patches (`list_workouts(user_id, date_from, date_to, limit, offset)`, etc.).
- Known simplification (documented): `list_workouts` streams then slices for offset pagination — fine at single-user volume; revisit with cursor pagination if needed. Firestore plumbing is deliberately not unit-tested against mocks; logic functions are.
