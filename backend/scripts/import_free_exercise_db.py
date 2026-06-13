"""
Import exercises from the Free Exercise DB (public domain) into the Firestore
`exercises` collection as system catalog rows.

Usage:
    python scripts/import_free_exercise_db.py

Idempotent — re-runs are safe. Doc IDs are prefixed with "fxdb-".
Existing sys- seeds are never touched.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import re
from typing import Optional

import requests

# ---------------------------------------------------------------------------
# Mapping tables (pure — imported by unit tests without any network/Firestore)
# ---------------------------------------------------------------------------

# Map Free Exercise DB muscle names -> our Muscle literals.
# Muscles not in this dict (e.g. "neck") are dropped silently.
MUSCLE_MAP: dict[str, str] = {
    "quadriceps": "quads",
    "hamstrings": "hamstrings",
    "glutes": "glutes",
    "abductors": "glutes",
    "adductors": "glutes",
    "chest": "chest",
    "lats": "back",
    "middle back": "back",
    "lower back": "back",
    "traps": "back",
    "shoulders": "shoulders",
    "biceps": "biceps",
    "triceps": "triceps",
    "abdominals": "core",
    "calves": "calves",
    "forearms": "forearms",
    # "neck" -> intentionally absent -> dropped
}

# Map Free Exercise DB equipment strings -> our Equipment literals.
EQUIPMENT_MAP: dict[str, str] = {
    "barbell": "barbell",
    "dumbbell": "dumbbell",
    "machine": "machine",
    "cable": "cable",
    "body only": "bodyweight",
    "kettlebells": "other",
    "bands": "other",
    "medicine ball": "other",
    "exercise ball": "other",
    "foam roll": "other",
    "other": "other",
    "e-z curl bar": "barbell",
}

# Categories we skip entirely (no sensible movement pattern).
SKIP_CATEGORIES = {"stretching", "cardio"}

# Name fragments that indicate a hinge pattern when primary muscles are
# hamstrings or glutes.
HINGE_NAME_KEYWORDS = {
    "deadlift", "swing", "good morning", "goodmorning",
    "thrust", "bridge", "snatch", "clean",
}


def map_muscles(muscle_list: list[str]) -> list[str]:
    """
    Map a list of Free Exercise DB muscle names to our Muscle literals.
    Unmappable entries are dropped.
    """
    result: list[str] = []
    seen: set[str] = set()
    for m in muscle_list:
        mapped = MUSCLE_MAP.get(m.lower().strip())
        if mapped and mapped not in seen:
            result.append(mapped)
            seen.add(mapped)
    return result


def map_equipment(raw: Optional[str]) -> str:
    """Map a Free Exercise DB equipment string to our Equipment literal."""
    if not raw:
        return "other"
    return EQUIPMENT_MAP.get(raw.lower().strip(), "other")


def pattern_for(
    category: str,
    primary_muscles: list[str],
    name: str,
    force: Optional[str] = None,
    mechanic: Optional[str] = None,
) -> Optional[str]:
    """
    Derive a MovementPattern from Free Exercise DB fields.

    Returns None when the exercise should be skipped entirely.

    Parameters
    ----------
    category:        their `category` field (e.g. "Stretching", "Chest")
    primary_muscles: already-mapped muscles (our vocabulary)
    name:            exercise name (used for keyword hinting)
    force:           their `force` field ("push", "pull", "static", None)
    mechanic:        their `mechanic` field ("compound", "isolation", None)
    """
    cat_lower = category.lower().strip() if category else ""
    if cat_lower in SKIP_CATEGORIES:
        return None

    name_lower = name.lower()

    # "carry" in name -> carry
    if "carry" in name_lower or "farmer" in name_lower:
        return "carry"

    # Primary quads -> squat
    if "quads" in primary_muscles:
        return "squat"

    # Primary hamstrings or glutes with hinge-y name -> hinge
    if any(m in primary_muscles for m in ("hamstrings", "glutes")):
        if any(kw in name_lower for kw in HINGE_NAME_KEYWORDS):
            return "hinge"

    # Primary core -> core
    if primary_muscles and primary_muscles[0] == "core":
        return "core"

    # Explicit force field
    force_lower = (force or "").lower().strip()
    if force_lower == "push":
        return "push"
    if force_lower == "pull":
        return "pull"

    # Category-level fallbacks
    if cat_lower in ("chest", "shoulders", "triceps"):
        return "push"
    if cat_lower in ("back", "biceps"):
        return "pull"
    if cat_lower in ("legs", "glutes"):
        # No hinge keyword and no quads primary: skip (ambiguous)
        return None
    if cat_lower == "core":
        return "core"

    # No mapping found -> skip
    return None


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def _normalise_name(name: str) -> str:
    """Lower-case, collapse whitespace, strip punctuation for dedup comparison."""
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


# ---------------------------------------------------------------------------
# Import logic
# ---------------------------------------------------------------------------

SOURCE_URL = (
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
)
IMAGE_BASE_URL = (
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"
)

LEVEL_MAP: dict[str, str] = {
    "beginner": "beginner",
    "intermediate": "intermediate",
    "expert": "expert",
}
CHUNK_SIZE = 400


def build_seed_name_set() -> set[str]:
    """Return normalised names of the 32 sys- seeded exercises."""
    from app.seed.exercises import SEED_EXERCISES
    return {_normalise_name(e["name"]) for e in SEED_EXERCISES}


def download_exercises() -> list[dict]:
    resp = requests.get(SOURCE_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()


def process_exercise(raw: dict, seed_names: set[str]) -> Optional[dict]:
    """
    Map one Free Exercise DB entry to our schema.

    Returns a (doc_id, doc_data) dict or None if the exercise should be skipped.
    """
    name: str = raw.get("name", "").strip()
    if not name:
        return None

    # Skip if normalised name matches a sys- seed
    if _normalise_name(name) in seed_names:
        return None

    category: str = raw.get("category", "") or ""
    force: Optional[str] = raw.get("force")
    mechanic: Optional[str] = raw.get("mechanic")

    raw_primary: list[str] = raw.get("primaryMuscles", []) or []
    raw_secondary: list[str] = raw.get("secondaryMuscles", []) or []

    primary_muscles = map_muscles(raw_primary)
    secondary_muscles = map_muscles(raw_secondary)

    # Must have at least one primary muscle after mapping
    if not primary_muscles:
        return None

    movement_pattern = pattern_for(
        category=category,
        primary_muscles=primary_muscles,
        name=name,
        force=force,
        mechanic=mechanic,
    )
    if movement_pattern is None:
        return None

    equipment = map_equipment(raw.get("equipment"))

    doc_id = "fxdb-" + str(raw.get("id", ""))

    # images: convert relative paths to absolute URLs
    raw_images: list[str] = raw.get("images", []) or []
    images = [IMAGE_BASE_URL + img for img in raw_images]

    # instructions: keep as-is
    instructions: list[str] = raw.get("instructions", []) or []

    # difficulty: map level field, default to "intermediate"
    raw_level: Optional[str] = raw.get("level")
    difficulty = LEVEL_MAP.get((raw_level or "").lower().strip(), "intermediate")

    doc = {
        "name": name,
        "primary_muscles": primary_muscles,
        "secondary_muscles": secondary_muscles,
        "movement_pattern": movement_pattern,
        "equipment": equipment,
        "user_id": "system",
        "is_custom": False,
        "images": images,
        "instructions": instructions,
        "difficulty": difficulty,
    }
    return {"id": doc_id, "doc": doc}


def main() -> None:
    from app.firestore import get_db

    print("Downloading exercises from Free Exercise DB…")
    exercises = download_exercises()
    print(f"  Downloaded {len(exercises)} exercises")

    seed_names = build_seed_name_set()

    db = get_db()
    col = db.collection("exercises")

    imported = 0
    skipped_unmappable = 0
    skipped_duplicates = 0

    # Collect all valid docs first so we can batch efficiently
    to_write: list[dict] = []
    for raw in exercises:
        result = process_exercise(raw, seed_names)
        if result is None:
            # Distinguish duplicate vs unmappable
            name = (raw.get("name", "") or "").strip()
            if _normalise_name(name) in seed_names:
                skipped_duplicates += 1
            else:
                skipped_unmappable += 1
        else:
            to_write.append(result)

    # Write in chunks of CHUNK_SIZE
    for i in range(0, len(to_write), CHUNK_SIZE):
        chunk = to_write[i : i + CHUNK_SIZE]
        batch = db.batch()
        for item in chunk:
            batch.set(col.document(item["id"]), item["doc"])
        batch.commit()
        imported += len(chunk)

    print(f"\nDone.")
    print(f"  Imported:            {imported}")
    print(f"  Skipped (unmappable): {skipped_unmappable}")
    print(f"  Skipped (duplicates): {skipped_duplicates}")


if __name__ == "__main__":
    main()
