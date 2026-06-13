"""Food log + favorites CRUD.

User isolation pattern: every read checks doc["user_id"] == uid.
Returns None when doc is missing or belongs to a different user.
Route layer translates None to 404.
"""
import logging
from datetime import datetime, timezone

from google.cloud import firestore

from app.firestore import get_db

logger = logging.getLogger(__name__)


def _doc(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


def _sum_macros(items: list[dict]) -> dict:
    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    for item in items:
        m = item.get("macros") or {}
        for key in totals:
            totals[key] += m.get(key, 0) or 0
    return totals


# ---- Food Logs ----

def create_log(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc = {
        "user_id": user_id,
        "date": payload["date"],
        "name": payload["name"],
        "serving": payload.get("serving", ""),
        "macros": payload["macros"],
        "source": payload.get("source", "manual"),
        "notes": payload.get("notes", ""),
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("food_logs").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def list_by_date(user_id: str, date: str) -> dict:
    db = get_db()
    snaps = (
        db.collection("food_logs")
        .where("user_id", "==", user_id)
        .where("date", "==", date)
        .stream()
    )
    items = [_doc(s) for s in snaps]
    return {"items": items, "totals": _sum_macros(items)}


def get_log(user_id: str, log_id: str) -> dict | None:
    snap = get_db().collection("food_logs").document(log_id).get()
    if not snap.exists:
        return None
    d = _doc(snap)
    if d.get("user_id") != user_id:
        return None
    return d


def update_log(user_id: str, log_id: str, updates: dict) -> dict | None:
    ref = get_db().collection("food_logs").document(log_id)
    snap = ref.get()
    if not snap.exists:
        return None
    d = snap.to_dict()
    if d.get("user_id") != user_id:
        return None
    ref.update(updates)
    return {**d, **updates, "id": log_id}


def delete_log(user_id: str, log_id: str) -> str | None:
    ref = get_db().collection("food_logs").document(log_id)
    snap = ref.get()
    if not snap.exists:
        return None
    if snap.to_dict().get("user_id") != user_id:
        return None
    ref.delete()
    return log_id


# ---- Favorites ----

def list_favorites(user_id: str) -> list[dict]:
    snaps = (
        get_db().collection("favorites")
        .where("user_id", "==", user_id)
        .order_by("last_used_at", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [_doc(s) for s in snaps]


def create_favorite(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc = {
        "user_id": user_id,
        "name": payload["name"],
        "serving": payload.get("serving", ""),
        "macros": payload["macros"],
        "last_used_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("favorites").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def delete_favorite(user_id: str, fav_id: str) -> str | None:
    ref = get_db().collection("favorites").document(fav_id)
    snap = ref.get()
    if not snap.exists:
        return None
    if snap.to_dict().get("user_id") != user_id:
        return None
    ref.delete()
    return fav_id


def suggest_foods(uid: str, q: str, limit: int = 10) -> list[dict]:
    """Return autocomplete suggestions from recent food_logs + favorites.

    Dedupes by lowercased name: favorite entry wins over recent for same name;
    among recents the newest wins. Caps candidate pool at 200.
    Filters by query tokens (all tokens must appear in name, case-insensitive).
    Empty q returns top `limit` most-recent entries.
    """
    db = get_db()

    # Fetch up to 500 recent food logs ordered by created_at desc
    log_snaps = (
        db.collection("food_logs")
        .where("user_id", "==", uid)
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(500)
        .stream()
    )
    recent_logs = [_doc(s) for s in log_snaps]

    # Fetch all favorites
    fav_snaps = (
        db.collection("favorites")
        .where("user_id", "==", uid)
        .stream()
    )
    favorites = [_doc(s) for s in fav_snaps]

    # Build deduped candidate map: lower_name -> dict
    # Priority: favorite > recent; among recents keep newest (already ordered desc)
    candidates: dict[str, dict] = {}

    # Add recents first (newer ones come first due to ordering)
    for log in recent_logs:
        key = (log.get("name") or "").strip().lower()
        if not key:
            continue
        if key not in candidates:
            created_raw = log.get("created_at")
            last_used_at: str | None = None
            if created_raw is not None:
                try:
                    last_used_at = created_raw.isoformat() if hasattr(created_raw, "isoformat") else str(created_raw)
                except Exception:
                    pass
            candidates[key] = {
                "name": log.get("name", ""),
                "serving": log.get("serving", ""),
                "macros": log.get("macros", {}),
                "source": "recent",
                "last_used_at": last_used_at,
            }

    # Overlay favorites (they override recents for the same name, keeping favorite source)
    for fav in favorites:
        key = (fav.get("name") or "").strip().lower()
        if not key:
            continue
        last_used_raw = fav.get("last_used_at")
        last_used_at = None
        if last_used_raw is not None:
            try:
                last_used_at = last_used_raw.isoformat() if hasattr(last_used_raw, "isoformat") else str(last_used_raw)
            except Exception:
                pass
        entry = {
            "name": fav.get("name", ""),
            "serving": fav.get("serving", ""),
            "macros": fav.get("macros", {}),
            "source": "favorite",
            "last_used_at": last_used_at,
        }
        candidates[key] = entry  # favorite always wins

    # Cap at 200 candidates
    candidate_list = list(candidates.values())[:200]

    # Filter by query tokens
    q_stripped = q.strip()
    if q_stripped:
        tokens = q_stripped.lower().split()
        filtered = [
            c for c in candidate_list
            if all(tok in c["name"].lower() for tok in tokens)
        ]
    else:
        filtered = candidate_list

    # Sort: favorites first, then by last_used_at desc (None last), then by name
    def sort_key(c: dict):
        source_rank = 0 if c["source"] == "favorite" else 1
        ts = c["last_used_at"] or ""
        return (source_rank, "" if not ts else ts, c["name"].lower())

    filtered.sort(key=lambda c: (
        0 if c["source"] == "favorite" else 1,
        # negate recency: newer timestamps are lexicographically larger, we want desc
        "" if not c["last_used_at"] else "\xff" + c["last_used_at"],
        c["name"].lower(),
    ))
    # Reverse the timestamp part: favorites first (0), then by timestamp desc
    # Re-sort with proper descending timestamp handling
    filtered.sort(key=lambda c: (
        0 if c["source"] == "favorite" else 1,
        c["name"].lower(),
    ))
    # Actually do a clean sort: favorites first by last_used_at desc, then recents by last_used_at desc
    def _sort(c: dict):
        s = 0 if c["source"] == "favorite" else 1
        ts = c["last_used_at"] or ""
        # We want descending timestamp, so negate via string trick: use inverse
        # Use empty string for missing (sorts last when reversed below)
        return (s, ts, c["name"].lower())

    filtered.sort(key=_sort, reverse=False)
    # Fix: favorites (s=0) come first but within each group we want newest first
    # Split into favorites and recents, sort each by timestamp desc, then concat
    favs_group = sorted(
        [c for c in filtered if c["source"] == "favorite"],
        key=lambda c: c["last_used_at"] or "",
        reverse=True,
    )
    recents_group = sorted(
        [c for c in filtered if c["source"] == "recent"],
        key=lambda c: c["last_used_at"] or "",
        reverse=True,
    )
    result = favs_group + recents_group

    return result[:limit]


def log_from_favorite(user_id: str, fav_id: str, date: str) -> dict | None:
    """Clone a favorite into a food log entry for the given date."""
    db = get_db()
    fav_ref = db.collection("favorites").document(fav_id)
    snap = fav_ref.get()
    if not snap.exists:
        return None
    fav = snap.to_dict()
    if fav.get("user_id") != user_id:
        return None
    # Update last_used_at on the favorite
    now = datetime.now(timezone.utc)
    fav_ref.update({"last_used_at": now})
    # Create the food log
    log_doc = {
        "user_id": user_id,
        "date": date,
        "name": fav["name"],
        "serving": fav.get("serving", ""),
        "macros": fav["macros"],
        "source": "favorite",
        "notes": "",
        "created_at": now,
    }
    ref = db.collection("food_logs").document()
    ref.set(log_doc)
    return {**log_doc, "id": ref.id}
