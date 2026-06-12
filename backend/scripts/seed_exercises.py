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
