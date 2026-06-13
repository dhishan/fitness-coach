"""TDD tests for CardioLogCreate schema."""
import pytest
from pydantic import ValidationError


def test_cardio_log_create_valid():
    from app.schemas import CardioLogCreate
    log = CardioLogCreate(date="2026-06-13", type="run", duration_s=1800)
    assert log.type == "run"
    assert log.duration_s == 1800
    assert log.distance_m == 0
    assert log.source == "manual"
    assert log.external_id is None


def test_cardio_log_create_all_fields():
    from app.schemas import CardioLogCreate
    log = CardioLogCreate(
        date="2026-06-13",
        type="ride",
        duration_s=3600,
        distance_m=25000.0,
        avg_hr=145,
        calories=600,
        notes="morning ride",
        source="healthkit",
        external_id="hk-uuid-123",
    )
    assert log.avg_hr == 145
    assert log.source == "healthkit"
    assert log.external_id == "hk-uuid-123"


def test_cardio_log_create_bad_date():
    from app.schemas import CardioLogCreate
    with pytest.raises(ValidationError):
        CardioLogCreate(date="13-06-2026", type="run", duration_s=600)


def test_cardio_log_create_negative_duration():
    from app.schemas import CardioLogCreate
    with pytest.raises(ValidationError):
        CardioLogCreate(date="2026-06-13", type="run", duration_s=-1)


def test_cardio_log_create_hr_too_low():
    from app.schemas import CardioLogCreate
    with pytest.raises(ValidationError):
        CardioLogCreate(date="2026-06-13", type="run", duration_s=600, avg_hr=10)


def test_cardio_log_create_hr_too_high():
    from app.schemas import CardioLogCreate
    with pytest.raises(ValidationError):
        CardioLogCreate(date="2026-06-13", type="run", duration_s=600, avg_hr=300)


def test_cardio_log_create_invalid_type():
    from app.schemas import CardioLogCreate
    with pytest.raises(ValidationError):
        CardioLogCreate(date="2026-06-13", type="yoga", duration_s=600)


def test_cardio_log_create_all_types():
    from app.schemas import CardioLogCreate
    for t in ["run", "ride", "walk", "swim", "other"]:
        log = CardioLogCreate(date="2026-06-13", type=t, duration_s=100)
        assert log.type == t


def test_cardio_log_create_missing_required():
    from app.schemas import CardioLogCreate
    with pytest.raises(ValidationError):
        CardioLogCreate(date="2026-06-13", duration_s=600)  # missing type


def test_cardio_log_update_partial():
    from app.schemas import CardioLogUpdate
    u = CardioLogUpdate(notes="updated")
    assert u.notes == "updated"
    assert u.duration_s is None
