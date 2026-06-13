"""TDD tests for body_service."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, call, patch


def _make_snap(data: dict, doc_id: str = "metric1", exists: bool = True):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = exists
    snap.to_dict.return_value = data.copy()
    return snap


BASE = {
    "user_id": "u1",
    "date": "2026-06-13",
    "weight_kg": 80.0,
    "body_fat_pct": None,
    "waist_cm": None,
    "chest_cm": None,
    "arm_cm": None,
    "thigh_cm": None,
    "photo_urls": [],
    "notes": "",
    "created_at": datetime(2026, 6, 13, 8, 0, tzinfo=timezone.utc),
}


# ---- create_metric ----

def test_create_metric_stores_user_id(mock_db):
    from app.services.body_service import create_metric
    ref = mock_db.collection.return_value.document.return_value
    result = create_metric("u1", {"date": "2026-06-13", "weight_kg": 80.0})
    written = ref.set.call_args[0][0]
    assert written["user_id"] == "u1"
    assert written["weight_kg"] == 80.0


def test_create_metric_returns_id(mock_db):
    from app.services.body_service import create_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.id = "new_id"
    result = create_metric("u1", {"date": "2026-06-13", "weight_kg": 75.0})
    assert result["id"] == "new_id"


def test_create_metric_sets_created_at(mock_db):
    from app.services.body_service import create_metric
    ref = mock_db.collection.return_value.document.return_value
    result = create_metric("u1", {"date": "2026-06-13", "weight_kg": 70.0})
    written = ref.set.call_args[0][0]
    assert "created_at" in written


# ---- list_metrics ----

def test_list_metrics_orders_by_date_desc(mock_db):
    from app.services.body_service import list_metrics
    snaps = [_make_snap({**BASE, "date": "2026-06-13"}, "m1"),
             _make_snap({**BASE, "date": "2026-06-12"}, "m2")]
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter(snaps)
    result = list_metrics("u1", limit=90)
    assert len(result) == 2
    assert result[0]["date"] == "2026-06-13"


def test_list_metrics_empty(mock_db):
    from app.services.body_service import list_metrics
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([])
    result = list_metrics("u1")
    assert result == []


# ---- latest_metric ----

def test_latest_metric_returns_first(mock_db):
    from app.services import body_service
    newer = {**BASE, "date": "2026-06-13", "weight_kg": 82.0}
    older = {**BASE, "date": "2026-06-10", "weight_kg": 80.0}
    snaps = [_make_snap(newer, "m1"), _make_snap(older, "m2")]
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter(snaps)
    result = body_service.latest_metric("u1")
    assert result["weight_kg"] == 82.0


def test_latest_metric_returns_none_when_empty(mock_db):
    from app.services import body_service
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([])
    assert body_service.latest_metric("u1") is None


# ---- latest_weight ----

def test_latest_weight_returns_weight(mock_db):
    from app.services import body_service
    snaps = [_make_snap({**BASE, "weight_kg": 78.5}, "m1")]
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter(snaps)
    assert body_service.latest_weight("u1") == 78.5


def test_latest_weight_returns_none_when_no_metrics(mock_db):
    from app.services import body_service
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([])
    assert body_service.latest_weight("u1") is None


# ---- get_metric ----

def test_get_metric_returns_doc(mock_db):
    from app.services.body_service import get_metric
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(BASE)
    result = get_metric("u1", "metric1")
    assert result["weight_kg"] == 80.0
    assert result["id"] == "metric1"


def test_get_metric_cross_user_returns_none(mock_db):
    from app.services.body_service import get_metric
    other_user = {**BASE, "user_id": "u2"}
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(other_user)
    assert get_metric("u1", "metric1") is None


def test_get_metric_missing_returns_none(mock_db):
    from app.services.body_service import get_metric
    snap = _make_snap({}, exists=False)
    mock_db.collection.return_value.document.return_value.get.return_value = snap
    assert get_metric("u1", "missing") is None


# ---- update_metric ----

def test_update_metric_happy_path(mock_db):
    from app.services.body_service import update_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(BASE)
    result = update_metric("u1", "metric1", {"weight_kg": 81.0})
    assert result["weight_kg"] == 81.0
    ref.update.assert_called_once_with({"weight_kg": 81.0})


def test_update_metric_cross_user_returns_none(mock_db):
    from app.services.body_service import update_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({**BASE, "user_id": "u2"})
    assert update_metric("u1", "metric1", {"weight_kg": 81.0}) is None


def test_update_metric_missing_returns_none(mock_db):
    from app.services.body_service import update_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({}, exists=False)
    assert update_metric("u1", "missing", {"weight_kg": 81.0}) is None


# ---- delete_metric ----

def test_delete_metric_happy_path(mock_db):
    from app.services.body_service import delete_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(BASE)
    result = delete_metric("u1", "metric1")
    assert result == "metric1"
    ref.delete.assert_called_once()


def test_delete_metric_cross_user_returns_none(mock_db):
    from app.services.body_service import delete_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({**BASE, "user_id": "u2"})
    assert delete_metric("u1", "metric1") is None


def test_delete_metric_missing_returns_none(mock_db):
    from app.services.body_service import delete_metric
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({}, exists=False)
    assert delete_metric("u1", "missing") is None
