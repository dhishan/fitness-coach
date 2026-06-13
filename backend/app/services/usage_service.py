import logging
from datetime import datetime, timedelta, timezone

from google.cloud import firestore

from app.firestore import get_db
from app.services.pricing import cost_usd

logger = logging.getLogger(__name__)


def record_usage(*, user_id: str, source: str, model: str, input_tokens: int,
                 output_tokens: int, duration_ms: int,
                 conversation_id: str | None = None) -> float:
    """Each write independently guarded - usage recording can never break the caller."""
    cost = cost_usd(model, input_tokens, output_tokens)
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")

    try:
        get_db().collection("usage_events").document().set({
            "user_id": user_id, "source": source, "model": model,
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "cost_usd": cost, "duration_ms": duration_ms,
            "conversation_id": conversation_id, "created_at": now,
        })
    except Exception:
        logger.exception("usage event write failed")

    try:
        (get_db().collection("user_usage_summaries").document(user_id)
         .collection("months").document(month).set({
            "input_tokens": firestore.Increment(input_tokens),
            "output_tokens": firestore.Increment(output_tokens),
            "cost_usd": firestore.Increment(cost),
            "calls": firestore.Increment(1),
            "updated_at": now,
         }, merge=True))
    except Exception:
        logger.exception("usage summary write failed")

    return cost


def monthly_summary(user_id: str, month: str) -> dict:
    try:
        snap = (get_db().collection("user_usage_summaries").document(user_id)
                .collection("months").document(month).get())
        if snap.exists:
            return {**snap.to_dict(), "month": month}
    except Exception:
        logger.exception("monthly summary read failed")
    return {"month": month, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}


def monthly_summary_by_source(user_id: str, month: str) -> dict:
    """Return per-source breakdown of usage events for the given YYYY-MM month."""
    out: dict[str, dict] = {}
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        query = (get_db().collection("usage_events")
                 .where(filter=firestore.FieldFilter("user_id", "==", user_id))
                 .where(filter=firestore.FieldFilter("created_at", ">=", start))
                 .where(filter=firestore.FieldFilter("created_at", "<", next_month)))
        for d in query.stream():
            doc = d.to_dict() or {}
            src = doc.get("source") or "unknown"
            bucket = out.setdefault(src, {"input_tokens": 0, "output_tokens": 0,
                                          "cost_usd": 0.0, "calls": 0})
            bucket["input_tokens"] += int(doc.get("input_tokens") or 0)
            bucket["output_tokens"] += int(doc.get("output_tokens") or 0)
            bucket["cost_usd"] += float(doc.get("cost_usd") or 0.0)
            bucket["calls"] += 1
    except Exception:
        logger.exception("monthly summary by source read failed")
    return {"month": month, "by_source": out}
