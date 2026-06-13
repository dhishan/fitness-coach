"""HealthKit batch ingestion.

Each kind (weight / steps / workout / hrv / sleep) is processed inside
its own try/except so a partial failure on one kind never blocks others.

Returns:
  {imported: {weight, steps, workouts, hrv, sleep}, skipped: N}
"""
import logging
from datetime import datetime, timezone

from app.firestore import get_db
from app.services import cardio_service

logger = logging.getLogger(__name__)

# Map HealthKit workout types → CardioType
_WORKOUT_TYPE_MAP = {
    "Running": "run",
    "Walking": "walk",
    "Cycling": "ride",
    "Swimming": "swim",
    "Other": "other",
}


def ingest_batch(uid: str, samples: list[dict]) -> dict:
    counts = {"weight": 0, "steps": 0, "workouts": 0, "hrv": 0, "sleep": 0}
    skipped = 0

    # Group by kind
    by_kind: dict[str, list[dict]] = {}
    for s in samples:
        by_kind.setdefault(s["kind"], []).append(s)

    # ---- weight ----
    # Idempotent: doc id = external_id (HealthKit UUID), set(merge=True) so
    # re-syncing the same sample updates in place rather than creating a new doc.
    try:
        db = get_db()
        for s in by_kind.get("weight", []):
            (
                db.collection("body_metrics")
                .document(s["external_id"])
                .set({
                    "user_id": uid,
                    "date": s["date"],
                    "weight_kg": s["value"],
                    "source": "healthkit",
                    "external_id": s["external_id"],
                    "notes": "",
                    "created_at": datetime.now(timezone.utc),
                }, merge=True)
            )
            counts["weight"] += 1
    except Exception:
        logger.exception("healthkit weight ingestion failed for uid=%s", uid)

    # ---- steps ----
    try:
        db = get_db()
        for s in by_kind.get("steps", []):
            (
                db.collection("daily_metrics")
                .document(uid)
                .collection("days")
                .document(s["date"])
                .set({"steps": s["value"], "date": s["date"], "updated_at": datetime.now(timezone.utc)}, merge=True)
            )
            counts["steps"] += 1
    except Exception:
        logger.exception("healthkit steps ingestion failed for uid=%s", uid)

    # ---- workouts ----
    try:
        for s in by_kind.get("workout", []):
            cardio_type = _WORKOUT_TYPE_MAP.get(s.get("workout_type", ""))
            if cardio_type is None:
                skipped += 1
                continue
            cardio_service.create_log(uid, {
                "date": s["date"],
                "type": cardio_type,
                "duration_s": s.get("duration_s") or 0,
                "distance_m": s.get("distance_m") or 0,
                "avg_hr": s.get("avg_hr"),
                "calories": s.get("calories"),
                "notes": "",
                "source": "healthkit",
                "external_id": s["external_id"],
            })
            counts["workouts"] += 1
    except Exception:
        logger.exception("healthkit workout ingestion failed for uid=%s", uid)

    # ---- hrv ----
    try:
        db = get_db()
        for s in by_kind.get("hrv", []):
            (
                db.collection("health_signals")
                .document(uid)
                .collection("hrv")
                .document(s["external_id"])
                .set({
                    "user_id": uid,
                    "date": s["date"],
                    "value_ms": s["value"],
                    "source": "healthkit",
                    "created_at": datetime.now(timezone.utc),
                }, merge=True)
            )
            counts["hrv"] += 1
    except Exception:
        logger.exception("healthkit hrv ingestion failed for uid=%s", uid)

    # ---- sleep ----
    try:
        db = get_db()
        for s in by_kind.get("sleep", []):
            (
                db.collection("health_signals")
                .document(uid)
                .collection("sleep")
                .document(s["external_id"])
                .set({
                    "user_id": uid,
                    "date": s["date"],
                    "duration_min": s["value"],
                    "source": "healthkit",
                    "created_at": datetime.now(timezone.utc),
                }, merge=True)
            )
            counts["sleep"] += 1
    except Exception:
        logger.exception("healthkit sleep ingestion failed for uid=%s", uid)

    return {"imported": counts, "skipped": skipped}
