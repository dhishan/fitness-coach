"""TDD tests for healthkit_service.ingest_batch."""
from unittest.mock import MagicMock, patch, call

CARDIO_SVC = "app.services.healthkit_service.cardio_service"
DB_PATH = "app.services.healthkit_service.get_db"


def _db():
    db = MagicMock()
    doc_ref = MagicMock()
    db.collection.return_value.document.return_value = doc_ref
    return db


WEIGHT_SAMPLE = {
    "kind": "weight",
    "external_id": "hk-w-1",
    "date": "2026-06-13",
    "value": 80.5,
}

STEPS_SAMPLE = {
    "kind": "steps",
    "external_id": "hk-s-1",
    "date": "2026-06-13",
    "value": 8000,
}

WORKOUT_RUN = {
    "kind": "workout",
    "external_id": "hk-wo-1",
    "date": "2026-06-13",
    "workout_type": "Running",
    "duration_s": 1800,
    "distance_m": 5000.0,
    "avg_hr": 150,
    "calories": 300,
    "value": None,
}

WORKOUT_STRENGTH = {
    "kind": "workout",
    "external_id": "hk-wo-s",
    "date": "2026-06-13",
    "workout_type": "TraditionalStrengthTraining",
    "duration_s": 3600,
    "distance_m": 0,
    "value": None,
}

HRV_SAMPLE = {
    "kind": "hrv",
    "external_id": "hk-hrv-1",
    "date": "2026-06-13",
    "value": 45.2,
}

SLEEP_SAMPLE = {
    "kind": "sleep",
    "external_id": "hk-sl-1",
    "date": "2026-06-13",
    "value": 420,
}


# ---- weight ----

def test_ingest_weight_writes_body_metrics_with_external_id(mock_db):
    from app.services.healthkit_service import ingest_batch
    result = ingest_batch("u1", [WEIGHT_SAMPLE])
    # doc id = external_id (deterministic) so re-syncs collide and merge
    mock_db.collection.assert_any_call("body_metrics")
    doc_ref = mock_db.collection.return_value.document
    doc_ref.assert_any_call("hk-w-1")
    set_call = mock_db.collection.return_value.document.return_value.set.call_args
    payload = set_call.args[0]
    assert payload["user_id"] == "u1"
    assert payload["weight_kg"] == 80.5
    assert payload["source"] == "healthkit"
    assert set_call.kwargs.get("merge") is True
    assert result["imported"]["weight"] == 1


def test_ingest_weight_idempotent_same_external_id(mock_db):
    """Ingesting the same weight sample twice targets the same deterministic
    doc id with merge=True — no duplicate documents created."""
    from app.services.healthkit_service import ingest_batch
    ingest_batch("u1", [WEIGHT_SAMPLE])
    ingest_batch("u1", [WEIGHT_SAMPLE])
    doc_ref = mock_db.collection.return_value.document
    ext_id_calls = [c for c in doc_ref.call_args_list if c.args == ("hk-w-1",)]
    assert len(ext_id_calls) == 2
    set_calls = mock_db.collection.return_value.document.return_value.set.call_args_list
    # Only set() calls on the body_metrics doc (filter by merge=True payload shape)
    weight_sets = [c for c in set_calls if c.args and c.args[0].get("weight_kg") == 80.5]
    assert len(weight_sets) == 2
    for c in weight_sets:
        assert c.kwargs.get("merge") is True


# ---- steps ----

def test_ingest_steps_writes_daily_metrics(mock_db):
    from app.services.healthkit_service import ingest_batch
    result = ingest_batch("u1", [STEPS_SAMPLE])
    # Firestore set called with steps data
    mock_db.collection.assert_any_call("daily_metrics")
    assert result["imported"]["steps"] == 1


# ---- workout (cardio) ----

def test_ingest_workout_run_calls_cardio_service(mock_db):
    from app.services.healthkit_service import ingest_batch
    with patch(CARDIO_SVC) as mock_cs:
        mock_cs.create_log.return_value = {"id": "c1"}
        result = ingest_batch("u1", [WORKOUT_RUN])
    mock_cs.create_log.assert_called_once()
    args = mock_cs.create_log.call_args.args
    assert args[0] == "u1"
    payload = args[1]
    assert payload["type"] == "run"
    assert payload["external_id"] == "hk-wo-1"
    assert payload["source"] == "healthkit"
    assert result["imported"]["workouts"] == 1


def test_ingest_workout_strength_is_skipped(mock_db):
    from app.services.healthkit_service import ingest_batch
    with patch(CARDIO_SVC) as mock_cs:
        result = ingest_batch("u1", [WORKOUT_STRENGTH])
    mock_cs.create_log.assert_not_called()
    assert result["imported"]["workouts"] == 0
    assert result["skipped"] >= 1


def test_ingest_workout_type_mapping(mock_db):
    from app.services.healthkit_service import ingest_batch
    cases = [
        ("Running", "run"),
        ("Walking", "walk"),
        ("Cycling", "ride"),
        ("Swimming", "swim"),
        ("Other", "other"),
    ]
    for hk_type, expected_cardio_type in cases:
        sample = {**WORKOUT_RUN, "workout_type": hk_type, "external_id": f"hk-{hk_type}"}
        with patch(CARDIO_SVC) as mock_cs:
            mock_cs.create_log.return_value = {"id": "c"}
            ingest_batch("u1", [sample])
        payload = mock_cs.create_log.call_args.args[1]
        assert payload["type"] == expected_cardio_type, f"Failed for {hk_type}"


# ---- hrv ----

def test_ingest_hrv_writes_health_signals(mock_db):
    from app.services.healthkit_service import ingest_batch
    result = ingest_batch("u1", [HRV_SAMPLE])
    mock_db.collection.assert_any_call("health_signals")
    assert result["imported"]["hrv"] == 1


# ---- sleep ----

def test_ingest_sleep_writes_health_signals(mock_db):
    from app.services.healthkit_service import ingest_batch
    result = ingest_batch("u1", [SLEEP_SAMPLE])
    mock_db.collection.assert_any_call("health_signals")
    assert result["imported"]["sleep"] == 1


# ---- mixed batch ----

def test_ingest_mixed_batch_returns_correct_counts(mock_db):
    from app.services.healthkit_service import ingest_batch
    samples = [
        WEIGHT_SAMPLE,
        STEPS_SAMPLE,
        WORKOUT_RUN,
        HRV_SAMPLE,
        SLEEP_SAMPLE,
    ]
    with patch(CARDIO_SVC) as mock_cs:
        mock_cs.create_log.return_value = {"id": "c"}
        result = ingest_batch("u1", samples)
    assert result["imported"]["weight"] == 1
    assert result["imported"]["steps"] == 1
    assert result["imported"]["workouts"] == 1
    assert result["imported"]["hrv"] == 1
    assert result["imported"]["sleep"] == 1


# ---- per-kind isolation (partial failure) ----

def test_weight_failure_does_not_block_steps(mock_db):
    """If weight subset raises, steps are still imported."""
    from app.services.healthkit_service import ingest_batch
    samples = [WEIGHT_SAMPLE, STEPS_SAMPLE]
    # Make ONLY the body_metrics doc set() raise; steps use a different collection path
    original_collection = mock_db.collection.side_effect

    def collection_router(name):
        col = MagicMock()
        if name == "body_metrics":
            col.document.return_value.set.side_effect = Exception("firestore error")
        return col

    mock_db.collection.side_effect = collection_router
    result = ingest_batch("u1", samples)
    mock_db.collection.side_effect = original_collection
    assert result["imported"]["weight"] == 0
    assert result["imported"]["steps"] == 1


def test_workout_failure_does_not_block_hrv(mock_db):
    """If workout subset raises, HRV still imported."""
    from app.services.healthkit_service import ingest_batch
    samples = [WORKOUT_RUN, HRV_SAMPLE]
    with patch(CARDIO_SVC) as mock_cs:
        mock_cs.create_log.side_effect = Exception("timeout")
        result = ingest_batch("u1", samples)
    assert result["imported"]["workouts"] == 0
    assert result["imported"]["hrv"] == 1


def test_no_exception_bubbles_from_any_kind_failure(mock_db):
    """Total failure in all subsets — ingest_batch returns zeros, no raise."""
    from app.services.healthkit_service import ingest_batch
    samples = [WEIGHT_SAMPLE, STEPS_SAMPLE, WORKOUT_RUN, HRV_SAMPLE, SLEEP_SAMPLE]
    with patch(CARDIO_SVC) as mock_cs:
        mock_cs.create_log.side_effect = Exception("fail")
        mock_db.collection.side_effect = Exception("firestore down")
        # Must not raise
        result = ingest_batch("u1", samples)
    assert isinstance(result, dict)
    assert "imported" in result
