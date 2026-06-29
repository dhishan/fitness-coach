"""Food log + favorites CRUD.

User isolation pattern: every read checks doc["user_id"] == uid.
Returns None when doc is missing or belongs to a different user.
Route layer translates None to 404.
"""
import hashlib
import logging
from datetime import datetime, timedelta, timezone

from google.cloud import firestore

from app.firestore import get_db

logger = logging.getLogger(__name__)

# Multi-source food search is identical for everyone and the underlying data
# (USDA/OFF/IFCT) is effectively static, so cache merged results across users.
_SEARCH_CACHE_TTL = timedelta(days=7)


def _search_cache_key(q: str, limit: int) -> str:
    # Not security-sensitive: this only derives a stable Firestore document id
    # from the (public, static) search query. usedforsecurity=False is the
    # correct annotation and keeps it working on FIPS builds.
    return hashlib.md5(
        f"{q.strip().lower()}|{limit}".encode(), usedforsecurity=False
    ).hexdigest()


def get_search_cache(q: str, limit: int) -> list[dict] | None:
    """Return cached merged search results, or None on miss/expiry/error."""
    try:
        snap = get_db().collection("food_search_cache").document(_search_cache_key(q, limit)).get()
        if not snap.exists:
            return None
        d = snap.to_dict() or {}
        ts = d.get("ts")
        if ts is None:
            return None
        # Firestore returns tz-aware datetimes; guard naive just in case.
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - ts > _SEARCH_CACHE_TTL:
            return None
        return d.get("results") or []
    except Exception:
        logger.exception("search cache read failed")
        return None


def set_search_cache(q: str, limit: int, results: list[dict]) -> None:
    try:
        get_db().collection("food_search_cache").document(_search_cache_key(q, limit)).set(
            {"q": q.strip().lower(), "results": results, "ts": datetime.now(timezone.utc)}
        )
    except Exception:
        logger.exception("search cache write failed")


def _doc(snap) -> dict:
    return {**snap.to_dict(), "id": snap.id}


_MICRO_KEYS = (
    "fiber_g", "sugar_g", "sodium_mg", "potassium_mg", "calcium_mg",
    "iron_mg", "vitamin_c_mg", "vitamin_d_mcg", "saturated_fat_g", "cholesterol_mg",
)


def _sum_macros(items: list[dict]) -> dict:
    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    for item in items:
        m = item.get("macros") or {}
        for key in totals:
            totals[key] += m.get(key, 0) or 0
    return totals


def _sum_micros(items: list[dict]) -> dict:
    totals = {k: 0.0 for k in _MICRO_KEYS}
    for item in items:
        m = item.get("micros") or {}
        for key in _MICRO_KEYS:
            totals[key] += m.get(key, 0) or 0
    return totals


# ---- Food Logs ----

def create_log(user_id: str, payload: dict) -> dict:
    db = get_db()
    doc: dict = {
        "user_id": user_id,
        "date": payload["date"],
        "name": payload["name"],
        "description": payload.get("description", ""),
        "serving": payload.get("serving", ""),
        "macros": payload["macros"],
        "source": payload.get("source", "manual"),
        "notes": payload.get("notes", ""),
        "created_at": datetime.now(timezone.utc),
    }
    # Optional new fields — only persist when present
    for field in ("meal_type", "logged_at", "micros", "usda_fdc_id", "micros_source"):
        value = payload.get(field)
        if value is not None:
            doc[field] = value
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
    return {
        "items": items,
        "totals": _sum_macros(items),
        "micros_totals": _sum_micros(items),
        "incomplete": get_day_incomplete(user_id, date),
    }


# ---- Day status (mark a day as untracked / "eating out") ----

def _day_status_id(user_id: str, date: str) -> str:
    return f"{user_id}_{date}"


def get_day_incomplete(user_id: str, date: str) -> bool:
    """Whether the user flagged this date as untracked (ate out, no data).

    Defaults to False. Never raises — a missing/broken status doc just
    means the day is treated as fully tracked.
    """
    try:
        snap = (
            get_db()
            .collection("nutrition_day_status")
            .document(_day_status_id(user_id, date))
            .get()
        )
        if not snap.exists:
            return False
        return bool((snap.to_dict() or {}).get("incomplete", False))
    except Exception:
        logger.exception("get_day_incomplete failed")
        return False


def set_day_incomplete(user_id: str, date: str, incomplete: bool) -> dict:
    doc = {
        "user_id": user_id,
        "date": date,
        "incomplete": bool(incomplete),
        "updated_at": datetime.now(timezone.utc),
    }
    get_db().collection("nutrition_day_status").document(
        _day_status_id(user_id, date)
    ).set(doc)
    return {**doc, "id": _day_status_id(user_id, date)}


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
        "micros": payload.get("micros"),
        "micros_source": payload.get("micros_source"),
        "last_used_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    ref = db.collection("favorites").document()
    ref.set(doc)
    return {**doc, "id": ref.id}


def update_favorite(user_id: str, fav_id: str, updates: dict) -> dict | None:
    ref = get_db().collection("favorites").document(fav_id)
    snap = ref.get()
    if not snap.exists:
        return None
    d = snap.to_dict()
    if d.get("user_id") != user_id:
        return None
    # Don't let a partial edit (e.g. the manual name/macros form) clobber stored
    # micros with nulls — only overwrite micros when the caller actually sends them.
    for k in ("micros", "micros_source"):
        if updates.get(k) is None:
            updates.pop(k, None)
    ref.update(updates)
    return {**d, **updates, "id": fav_id}


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
        "micros": fav.get("micros"),
        "micros_source": fav.get("micros_source"),
        "source": "favorite",
        "notes": "",
        "created_at": now,
    }
    ref = db.collection("food_logs").document()
    ref.set(log_doc)
    return {**log_doc, "id": ref.id}
