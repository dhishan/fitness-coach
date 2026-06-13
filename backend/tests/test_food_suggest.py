"""TDD tests for food_service.suggest_foods."""
from unittest.mock import MagicMock
from datetime import datetime, timezone

import pytest


def _make_snap(data: dict, doc_id: str = "doc1"):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = True
    snap.to_dict.return_value = data
    return snap


def _ts(s: str) -> datetime:
    """Return a UTC datetime from an ISO string (used as created_at)."""
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def _setup_db(mock_db, log_snaps=None, fav_snaps=None):
    """Wire up mock_db so food_logs and favorites queries return the given snaps."""
    log_snaps = log_snaps or []
    fav_snaps = fav_snaps or []

    def col_side(name):
        col = MagicMock()
        if name == "food_logs":
            col.where.return_value.order_by.return_value.limit.return_value.stream.return_value = iter(log_snaps)
        else:  # favorites
            col.where.return_value.stream.return_value = iter(fav_snaps)
        return col

    mock_db.collection.side_effect = col_side


# ---------------------------------------------------------------------------
# Deduplicate: log + favorite for same name — favorite wins, uses its macros
# ---------------------------------------------------------------------------

def test_dedupe_favorite_wins_over_recent(mock_db):
    from app.services.food_service import suggest_foods

    log_snap = _make_snap({
        "user_id": "u1", "name": "Oats", "serving": "100g",
        "macros": {"calories": 300, "protein_g": 10, "carbs_g": 54, "fat_g": 5},
        "created_at": _ts("2026-06-10T08:00:00"),
    }, "log1")
    fav_snap = _make_snap({
        "user_id": "u1", "name": "Oats", "serving": "150g",
        "macros": {"calories": 450, "protein_g": 15, "carbs_g": 81, "fat_g": 7},
        "last_used_at": _ts("2026-06-11T08:00:00"),
    }, "fav1")

    _setup_db(mock_db, log_snaps=[log_snap], fav_snaps=[fav_snap])
    results = suggest_foods("u1", "")

    # Should return exactly one entry (deduped by lowercased name)
    assert len(results) == 1
    r = results[0]
    assert r["source"] == "favorite"
    assert r["name"] == "Oats"
    # favorite macros win (450 kcal), not log macros (300 kcal)
    assert r["macros"]["calories"] == 450
    assert r["serving"] == "150g"


# ---------------------------------------------------------------------------
# Deduplicate: keep newest macro from logs when no favorite
# ---------------------------------------------------------------------------

def test_dedupe_keeps_newest_log_macros(mock_db):
    from app.services.food_service import suggest_foods

    # older entry has 300 kcal, newer has 350 kcal — snaps already ordered desc
    older = _make_snap({
        "user_id": "u1", "name": "Rice bowl", "serving": "1 cup",
        "macros": {"calories": 300, "protein_g": 8, "carbs_g": 60, "fat_g": 2},
        "created_at": _ts("2026-06-01T12:00:00"),
    }, "log_old")
    newer = _make_snap({
        "user_id": "u1", "name": "Rice bowl", "serving": "1 cup",
        "macros": {"calories": 350, "protein_g": 9, "carbs_g": 70, "fat_g": 3},
        "created_at": _ts("2026-06-10T12:00:00"),
    }, "log_new")

    # Firestore returns desc order (newest first)
    _setup_db(mock_db, log_snaps=[newer, older], fav_snaps=[])
    results = suggest_foods("u1", "")

    assert len(results) == 1
    assert results[0]["macros"]["calories"] == 350


# ---------------------------------------------------------------------------
# Token filter: "chicken rice" must match "Chicken rice bowl"
# ---------------------------------------------------------------------------

def test_token_filter_all_tokens_must_match(mock_db):
    from app.services.food_service import suggest_foods

    snaps = [
        _make_snap({
            "user_id": "u1", "name": "Chicken rice bowl", "serving": "1 bowl",
            "macros": {"calories": 500, "protein_g": 35, "carbs_g": 60, "fat_g": 10},
            "created_at": _ts("2026-06-10T12:00:00"),
        }, "log1"),
        _make_snap({
            "user_id": "u1", "name": "Chicken soup", "serving": "1 cup",
            "macros": {"calories": 150, "protein_g": 12, "carbs_g": 10, "fat_g": 4},
            "created_at": _ts("2026-06-09T12:00:00"),
        }, "log2"),
        _make_snap({
            "user_id": "u1", "name": "Fried rice", "serving": "1 cup",
            "macros": {"calories": 400, "protein_g": 8, "carbs_g": 70, "fat_g": 12},
            "created_at": _ts("2026-06-08T12:00:00"),
        }, "log3"),
    ]
    _setup_db(mock_db, log_snaps=snaps, fav_snaps=[])

    results = suggest_foods("u1", "chicken rice")

    names = [r["name"] for r in results]
    # "Chicken rice bowl" has both tokens; "Chicken soup" and "Fried rice" each have only one
    assert "Chicken rice bowl" in names
    assert "Chicken soup" not in names
    assert "Fried rice" not in names


# ---------------------------------------------------------------------------
# Empty q returns top-N most-recent
# ---------------------------------------------------------------------------

def test_empty_q_returns_top_recent(mock_db):
    from app.services.food_service import suggest_foods

    snaps = [
        _make_snap({
            "user_id": "u1", "name": f"Food {i}", "serving": "",
            "macros": {"calories": 100 * i, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
            "created_at": _ts(f"2026-06-{i:02d}T12:00:00"),
        }, f"log{i}")
        for i in range(1, 13)  # 12 unique foods
    ]
    # Firestore returns newest first; snap list already in desc order (12 down to 1)
    snaps_desc = list(reversed(snaps))
    _setup_db(mock_db, log_snaps=snaps_desc, fav_snaps=[])

    results = suggest_foods("u1", "", limit=10)
    assert len(results) == 10


# ---------------------------------------------------------------------------
# Favorites rank above recents for same query
# ---------------------------------------------------------------------------

def test_favorites_rank_above_recents(mock_db):
    from app.services.food_service import suggest_foods

    log_snap = _make_snap({
        "user_id": "u1", "name": "Eggs", "serving": "2 eggs",
        "macros": {"calories": 140, "protein_g": 12, "carbs_g": 1, "fat_g": 10},
        "created_at": _ts("2026-06-12T08:00:00"),
    }, "log1")
    fav_snap = _make_snap({
        "user_id": "u1", "name": "Oats", "serving": "100g",
        "macros": {"calories": 300, "protein_g": 10, "carbs_g": 54, "fat_g": 5},
        "last_used_at": _ts("2026-06-10T08:00:00"),
    }, "fav1")

    _setup_db(mock_db, log_snaps=[log_snap], fav_snaps=[fav_snap])
    results = suggest_foods("u1", "")

    # Favorite should come first even though the log was used more recently
    assert results[0]["source"] == "favorite"
    assert results[0]["name"] == "Oats"
    assert results[1]["source"] == "recent"
    assert results[1]["name"] == "Eggs"


# ---------------------------------------------------------------------------
# limit parameter is honoured
# ---------------------------------------------------------------------------

def test_limit_is_honoured(mock_db):
    from app.services.food_service import suggest_foods

    snaps = [
        _make_snap({
            "user_id": "u1", "name": f"Item {i}", "serving": "",
            "macros": {"calories": 100, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
            "created_at": _ts("2026-06-10T12:00:00"),
        }, f"log{i}")
        for i in range(20)
    ]
    _setup_db(mock_db, log_snaps=snaps, fav_snaps=[])
    results = suggest_foods("u1", "", limit=5)
    assert len(results) == 5


# ---------------------------------------------------------------------------
# No match: empty list returned (not an error)
# ---------------------------------------------------------------------------

def test_no_match_returns_empty_list(mock_db):
    from app.services.food_service import suggest_foods

    snap = _make_snap({
        "user_id": "u1", "name": "Oats", "serving": "100g",
        "macros": {"calories": 300, "protein_g": 10, "carbs_g": 54, "fat_g": 5},
        "created_at": _ts("2026-06-10T12:00:00"),
    }, "log1")
    _setup_db(mock_db, log_snaps=[snap], fav_snaps=[])

    results = suggest_foods("u1", "pizza")
    assert results == []
