"""TDD tests for body metric schemas."""
import pytest
from pydantic import ValidationError

from app.schemas import BodyMetricCreate, BodyMetricUpdate


# ---- BodyMetricCreate ----

def test_valid_body_metric_create():
    m = BodyMetricCreate(date="2026-06-13", weight_kg=80.0)
    assert m.weight_kg == 80.0
    assert m.body_fat_pct is None
    assert m.photo_urls == []
    assert m.notes == ""


def test_weight_zero_rejected():
    with pytest.raises(ValidationError):
        BodyMetricCreate(date="2026-06-13", weight_kg=0.0)


def test_weight_negative_rejected():
    with pytest.raises(ValidationError):
        BodyMetricCreate(date="2026-06-13", weight_kg=-1.0)


def test_weight_over_400_rejected():
    with pytest.raises(ValidationError):
        BodyMetricCreate(date="2026-06-13", weight_kg=401.0)


def test_weight_exactly_400_accepted():
    m = BodyMetricCreate(date="2026-06-13", weight_kg=400.0)
    assert m.weight_kg == 400.0


def test_weight_very_small_positive_accepted():
    m = BodyMetricCreate(date="2026-06-13", weight_kg=0.1)
    assert m.weight_kg == 0.1


def test_bad_date_pattern_rejected():
    with pytest.raises(ValidationError):
        BodyMetricCreate(date="13-06-2026", weight_kg=80.0)


def test_date_pattern_valid():
    m = BodyMetricCreate(date="2026-01-01", weight_kg=70.0)
    assert m.date == "2026-01-01"


def test_none_optionals_accepted():
    m = BodyMetricCreate(
        date="2026-06-13",
        weight_kg=75.0,
        body_fat_pct=None,
        waist_cm=None,
        chest_cm=None,
        arm_cm=None,
        thigh_cm=None,
    )
    assert m.body_fat_pct is None
    assert m.waist_cm is None


def test_all_optional_fields_accepted():
    m = BodyMetricCreate(
        date="2026-06-13",
        weight_kg=75.0,
        body_fat_pct=18.5,
        waist_cm=82.0,
        chest_cm=100.0,
        arm_cm=35.0,
        thigh_cm=58.0,
        photo_urls=["https://example.com/photo.jpg"],
        notes="Morning, fasted",
    )
    assert m.body_fat_pct == 18.5
    assert m.waist_cm == 82.0


# ---- BodyMetricUpdate ----

def test_update_all_none_is_valid():
    m = BodyMetricUpdate()
    assert m.weight_kg is None
    assert m.notes is None


def test_update_weight_zero_rejected():
    with pytest.raises(ValidationError):
        BodyMetricUpdate(weight_kg=0.0)


def test_update_weight_over_400_rejected():
    with pytest.raises(ValidationError):
        BodyMetricUpdate(weight_kg=500.0)


def test_update_partial_is_valid():
    m = BodyMetricUpdate(weight_kg=82.5, notes="Evening")
    assert m.weight_kg == 82.5
    assert m.notes == "Evening"
    assert m.waist_cm is None
