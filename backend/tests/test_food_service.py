"""TDD tests for food_service."""
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

import pytest


# ---- helpers ----

def _make_snap(data: dict, doc_id: str = "doc1"):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = True
    snap.to_dict.return_value = data
    return snap


def _make_db():
    """Return a mock db where collection(...).document(...) chains work."""
    db = MagicMock()
    return db


# ---- create_log ----

def test_create_log_persists_with_user_id(mock_db):
    from app.services.food_service import create_log
    ref = MagicMock()
    ref.id = "log1"
    mock_db.collection.return_value.document.return_value = ref
    payload = {
        "date": "2026-06-13",
        "name": "Apple",
        "serving": "1 medium",
        "macros": {"calories": 95, "protein_g": 0.5, "carbs_g": 25.0, "fat_g": 0.3},
        "source": "manual",
        "notes": "",
    }
    result = create_log("user1", payload)
    assert result["id"] == "log1"
    assert result["user_id"] == "user1"
    assert result["name"] == "Apple"
    ref.set.assert_called_once()
    doc_written = ref.set.call_args[0][0]
    assert doc_written["user_id"] == "user1"
    assert doc_written["date"] == "2026-06-13"


# ---- list_by_date ----

def test_list_by_date_returns_items_and_totals(mock_db):
    from app.services.food_service import list_by_date
    snaps = [
        _make_snap({
            "user_id": "user1", "date": "2026-06-13", "name": "Apple",
            "serving": "", "macros": {"calories": 95, "protein_g": 0.5, "carbs_g": 25.0, "fat_g": 0.3},
            "source": "manual", "notes": "", "created_at": None,
        }, "log1"),
        _make_snap({
            "user_id": "user1", "date": "2026-06-13", "name": "Egg",
            "serving": "", "macros": {"calories": 70, "protein_g": 6.0, "carbs_g": 0.0, "fat_g": 5.0},
            "source": "manual", "notes": "", "created_at": None,
        }, "log2"),
    ]
    mock_db.collection.return_value.where.return_value.where.return_value.stream.return_value = iter(snaps)
    result = list_by_date("user1", "2026-06-13")
    assert len(result["items"]) == 2
    totals = result["totals"]
    assert totals["calories"] == pytest.approx(165)
    assert totals["protein_g"] == pytest.approx(6.5)
    assert totals["carbs_g"] == pytest.approx(25.0)
    assert totals["fat_g"] == pytest.approx(5.3)


def test_list_by_date_empty(mock_db):
    from app.services.food_service import list_by_date
    mock_db.collection.return_value.where.return_value.where.return_value.stream.return_value = iter([])
    result = list_by_date("user1", "2026-06-13")
    assert result["items"] == []
    assert result["totals"]["calories"] == 0


# ---- get_log ----

def test_get_log_returns_doc(mock_db):
    from app.services.food_service import get_log
    data = {
        "user_id": "user1", "date": "2026-06-13", "name": "Apple",
        "serving": "", "macros": {"calories": 95, "protein_g": 0.5, "carbs_g": 25.0, "fat_g": 0.3},
        "source": "manual", "notes": "",
    }
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(data, "log1")
    result = get_log("user1", "log1")
    assert result["id"] == "log1"
    assert result["name"] == "Apple"


def test_get_log_cross_user_returns_none(mock_db):
    from app.services.food_service import get_log
    data = {"user_id": "other_user", "name": "Apple"}
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(data, "log1")
    result = get_log("user1", "log1")
    assert result is None


def test_get_log_missing_returns_none(mock_db):
    from app.services.food_service import get_log
    snap = MagicMock()
    snap.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = snap
    result = get_log("user1", "missing")
    assert result is None


# ---- update_log ----

def test_update_log_cross_user_returns_none(mock_db):
    from app.services.food_service import update_log
    data = {"user_id": "other", "name": "Apple"}
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(data, "log1")
    result = update_log("user1", "log1", {"name": "Banana"})
    assert result is None


def test_update_log_updates_fields(mock_db):
    from app.services.food_service import update_log
    data = {
        "user_id": "user1", "date": "2026-06-13", "name": "Apple",
        "serving": "", "macros": {"calories": 95, "protein_g": 0.5, "carbs_g": 25.0, "fat_g": 0.3},
        "source": "manual", "notes": "",
    }
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(data, "log1")
    result = update_log("user1", "log1", {"name": "Big Apple"})
    ref.update.assert_called_once()
    update_payload = ref.update.call_args[0][0]
    assert update_payload["name"] == "Big Apple"
    assert result["name"] == "Big Apple"


# ---- delete_log ----

def test_delete_log_cross_user_returns_none(mock_db):
    from app.services.food_service import delete_log
    data = {"user_id": "other"}
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(data)
    result = delete_log("user1", "log1")
    assert result is None


def test_delete_log_deletes_and_returns_id(mock_db):
    from app.services.food_service import delete_log
    data = {"user_id": "user1", "name": "Apple"}
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(data, "log1")
    result = delete_log("user1", "log1")
    ref.delete.assert_called_once()
    assert result == "log1"


# ---- favorites ----

def test_create_favorite_persists(mock_db):
    from app.services.food_service import create_favorite
    ref = MagicMock()
    ref.id = "fav1"
    mock_db.collection.return_value.document.return_value = ref
    payload = {
        "name": "Oats",
        "serving": "100g",
        "macros": {"calories": 300, "protein_g": 10, "carbs_g": 54, "fat_g": 5},
    }
    result = create_favorite("user1", payload)
    assert result["id"] == "fav1"
    assert result["user_id"] == "user1"
    ref.set.assert_called_once()


def test_list_favorites(mock_db):
    from app.services.food_service import list_favorites
    snaps = [_make_snap({
        "user_id": "user1", "name": "Oats", "serving": "100g",
        "macros": {"calories": 300, "protein_g": 10, "carbs_g": 54, "fat_g": 5},
        "last_used_at": None,
    }, "fav1")]
    mock_db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = iter(snaps)
    result = list_favorites("user1")
    assert len(result) == 1
    assert result[0]["name"] == "Oats"


def test_delete_favorite_cross_user_returns_none(mock_db):
    from app.services.food_service import delete_favorite
    data = {"user_id": "other"}
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(data)
    result = delete_favorite("user1", "fav1")
    assert result is None


def test_delete_favorite_deletes_and_returns_id(mock_db):
    from app.services.food_service import delete_favorite
    data = {"user_id": "user1", "name": "Oats"}
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(data, "fav1")
    result = delete_favorite("user1", "fav1")
    ref.delete.assert_called_once()
    assert result == "fav1"


# ---- log_from_favorite ----

def test_log_from_favorite_creates_food_log(mock_db):
    from app.services.food_service import log_from_favorite
    fav_data = {
        "user_id": "user1", "name": "Oats", "serving": "100g",
        "macros": {"calories": 300, "protein_g": 10, "carbs_g": 54, "fat_g": 5},
        "last_used_at": None,
    }
    new_ref = MagicMock()
    new_ref.id = "log_from_fav"

    fav_ref = MagicMock()
    fav_ref.get.return_value = _make_snap(fav_data, "fav1")

    def collection_side_effect(name):
        col = MagicMock()
        if name == "favorites":
            col.document.return_value = fav_ref
        else:
            col.document.return_value = new_ref
        return col

    mock_db.collection.side_effect = collection_side_effect
    result = log_from_favorite("user1", "fav1", "2026-06-13")
    assert result is not None
    assert result["id"] == "log_from_fav"
    assert result["source"] == "favorite"
    assert result["name"] == "Oats"
    # last_used_at updated on favorite
    fav_ref.update.assert_called_once()


def test_log_from_favorite_cross_user_returns_none(mock_db):
    from app.services.food_service import log_from_favorite
    fav_data = {"user_id": "other", "name": "Oats"}
    fav_ref = MagicMock()
    fav_ref.get.return_value = _make_snap(fav_data, "fav1")
    mock_db.collection.return_value.document.return_value = fav_ref
    result = log_from_favorite("user1", "fav1", "2026-06-13")
    assert result is None


def test_log_from_favorite_missing_fav_returns_none(mock_db):
    from app.services.food_service import log_from_favorite
    snap = MagicMock()
    snap.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = snap
    result = log_from_favorite("user1", "missing", "2026-06-13")
    assert result is None
