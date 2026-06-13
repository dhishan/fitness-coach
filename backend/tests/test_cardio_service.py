"""TDD tests for cardio_service."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, call


def _make_snap(data: dict, doc_id: str = "log1", exists: bool = True):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = exists
    snap.to_dict.return_value = data.copy()
    return snap


BASE = {
    "user_id": "u1",
    "date": "2026-06-13",
    "type": "run",
    "duration_s": 1800,
    "distance_m": 5000.0,
    "avg_hr": 150,
    "calories": 300,
    "notes": "",
    "source": "manual",
    "external_id": None,
    "created_at": datetime(2026, 6, 13, 8, 0, tzinfo=timezone.utc),
}


# ---- create_log ----

def test_create_log_stores_user_id(mock_db):
    from app.services.cardio_service import create_log
    ref = mock_db.collection.return_value.document.return_value
    create_log("u1", {"date": "2026-06-13", "type": "run", "duration_s": 1800})
    written = ref.set.call_args[0][0]
    assert written["user_id"] == "u1"


def test_create_log_returns_id(mock_db):
    from app.services.cardio_service import create_log
    ref = mock_db.collection.return_value.document.return_value
    ref.id = "new_id"
    result = create_log("u1", {"date": "2026-06-13", "type": "run", "duration_s": 600})
    assert result["id"] == "new_id"


def test_create_log_sets_created_at(mock_db):
    from app.services.cardio_service import create_log
    ref = mock_db.collection.return_value.document.return_value
    create_log("u1", {"date": "2026-06-13", "type": "walk", "duration_s": 900})
    written = ref.set.call_args[0][0]
    assert "created_at" in written


def test_create_log_idempotent_by_external_id_returns_existing(mock_db):
    """When external_id is set and doc already exists, return it without duplicating."""
    from app.services.cardio_service import create_log

    existing_snap = _make_snap({**BASE, "external_id": "hk-uuid-1"}, "existing_id")
    # Simulate the query returning one result
    (
        mock_db.collection.return_value
        .where.return_value
        .where.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([existing_snap])

    result = create_log("u1", {
        "date": "2026-06-13", "type": "run", "duration_s": 1800, "external_id": "hk-uuid-1"
    })
    # Should NOT call .set() on a new doc
    new_doc_ref = mock_db.collection.return_value.document.return_value
    new_doc_ref.set.assert_not_called()
    assert result["id"] == "existing_id"


def test_create_log_no_external_id_always_creates(mock_db):
    """Without external_id, skip idempotency query and always create."""
    from app.services.cardio_service import create_log
    ref = mock_db.collection.return_value.document.return_value
    ref.id = "brand_new"
    result = create_log("u1", {"date": "2026-06-13", "type": "swim", "duration_s": 2400})
    ref.set.assert_called_once()
    assert result["id"] == "brand_new"


# ---- list_logs ----

def test_list_logs_filters_by_user(mock_db):
    from app.services.cardio_service import list_logs
    snaps = [_make_snap({**BASE}, "l1"), _make_snap({**BASE, "date": "2026-06-12"}, "l2")]
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter(snaps)
    result = list_logs("u1")
    assert len(result) == 2


def test_list_logs_empty(mock_db):
    from app.services.cardio_service import list_logs
    (
        mock_db.collection.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([])
    assert list_logs("u1") == []


# ---- get_log ----

def test_get_log_returns_doc(mock_db):
    from app.services.cardio_service import get_log
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(BASE)
    result = get_log("u1", "log1")
    assert result["type"] == "run"
    assert result["id"] == "log1"


def test_get_log_cross_user_returns_none(mock_db):
    from app.services.cardio_service import get_log
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap(
        {**BASE, "user_id": "u2"}
    )
    assert get_log("u1", "log1") is None


def test_get_log_missing_returns_none(mock_db):
    from app.services.cardio_service import get_log
    mock_db.collection.return_value.document.return_value.get.return_value = _make_snap({}, exists=False)
    assert get_log("u1", "missing") is None


# ---- update_log ----

def test_update_log_happy_path(mock_db):
    from app.services.cardio_service import update_log
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(BASE)
    result = update_log("u1", "log1", {"duration_s": 2400})
    assert result["duration_s"] == 2400
    ref.update.assert_called_once_with({"duration_s": 2400})


def test_update_log_cross_user_returns_none(mock_db):
    from app.services.cardio_service import update_log
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({**BASE, "user_id": "u2"})
    assert update_log("u1", "log1", {"duration_s": 2400}) is None


def test_update_log_missing_returns_none(mock_db):
    from app.services.cardio_service import update_log
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({}, exists=False)
    assert update_log("u1", "missing", {"duration_s": 2400}) is None


# ---- delete_log ----

def test_delete_log_happy_path(mock_db):
    from app.services.cardio_service import delete_log
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap(BASE)
    result = delete_log("u1", "log1")
    assert result == "log1"
    ref.delete.assert_called_once()


def test_delete_log_cross_user_returns_none(mock_db):
    from app.services.cardio_service import delete_log
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({**BASE, "user_id": "u2"})
    assert delete_log("u1", "log1") is None


def test_delete_log_missing_returns_none(mock_db):
    from app.services.cardio_service import delete_log
    ref = mock_db.collection.return_value.document.return_value
    ref.get.return_value = _make_snap({}, exists=False)
    assert delete_log("u1", "missing") is None
