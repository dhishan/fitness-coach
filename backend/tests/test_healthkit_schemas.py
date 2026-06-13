"""TDD tests for HealthKitSample and HealthKitBatch schemas."""
import pytest
from pydantic import ValidationError


def test_healthkit_sample_weight_valid():
    from app.schemas import HealthKitSample
    s = HealthKitSample(kind="weight", external_id="uuid-1", date="2026-06-13", value=80.5)
    assert s.kind == "weight"
    assert s.value == 80.5


def test_healthkit_sample_workout_valid():
    from app.schemas import HealthKitSample
    s = HealthKitSample(
        kind="workout",
        external_id="uuid-2",
        date="2026-06-13",
        workout_type="Running",
        duration_s=1800,
        distance_m=5000.0,
        avg_hr=150,
        calories=350,
    )
    assert s.workout_type == "Running"
    assert s.duration_s == 1800


def test_healthkit_sample_bad_date_not_validated():
    """HealthKitSample.date is a plain str (no pattern) — mobile normalizes it."""
    from app.schemas import HealthKitSample
    s = HealthKitSample(kind="steps", external_id="u", date="not-a-date", value=1000)
    assert s.date == "not-a-date"


def test_healthkit_sample_hr_out_of_range():
    from app.schemas import HealthKitSample
    with pytest.raises(ValidationError):
        HealthKitSample(kind="workout", external_id="u", date="2026-06-13", avg_hr=5)


def test_healthkit_sample_invalid_kind():
    from app.schemas import HealthKitSample
    with pytest.raises(ValidationError):
        HealthKitSample(kind="blood_pressure", external_id="u", date="2026-06-13")


def test_healthkit_sample_missing_external_id():
    from app.schemas import HealthKitSample
    with pytest.raises(ValidationError):
        HealthKitSample(kind="weight", date="2026-06-13", value=80.0)


def test_healthkit_batch_empty():
    from app.schemas import HealthKitBatch
    b = HealthKitBatch(samples=[])
    assert b.samples == []


def test_healthkit_batch_multiple_samples():
    from app.schemas import HealthKitBatch, HealthKitSample
    b = HealthKitBatch(samples=[
        HealthKitSample(kind="weight", external_id="a", date="2026-06-13", value=80.0),
        HealthKitSample(kind="steps", external_id="b", date="2026-06-13", value=8000),
        HealthKitSample(kind="hrv", external_id="c", date="2026-06-13", value=45.2),
        HealthKitSample(kind="sleep", external_id="d", date="2026-06-13", value=420),
    ])
    assert len(b.samples) == 4


def test_healthkit_sample_all_kinds():
    from app.schemas import HealthKitSample
    for kind in ["weight", "steps", "workout", "hrv", "sleep"]:
        s = HealthKitSample(kind=kind, external_id="x", date="2026-06-13")
        assert s.kind == kind
