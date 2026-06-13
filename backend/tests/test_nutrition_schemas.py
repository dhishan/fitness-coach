import pytest
from pydantic import ValidationError

from app.schemas import (
    FavoriteCreate,
    FoodLogCreate,
    FoodLogUpdate,
    GoalsUpdate,
    Macros,
)


# ---- Macros ----

def test_macros_valid():
    m = Macros(calories=500, protein_g=30.0, carbs_g=60.0, fat_g=15.0)
    assert m.calories == 500
    assert m.protein_g == 30.0


def test_macros_rejects_negative_calories():
    with pytest.raises(ValidationError):
        Macros(calories=-1, protein_g=0, carbs_g=0, fat_g=0)


def test_macros_rejects_negative_protein():
    with pytest.raises(ValidationError):
        Macros(calories=0, protein_g=-0.1, carbs_g=0, fat_g=0)


def test_macros_rejects_negative_carbs():
    with pytest.raises(ValidationError):
        Macros(calories=0, protein_g=0, carbs_g=-5, fat_g=0)


def test_macros_rejects_negative_fat():
    with pytest.raises(ValidationError):
        Macros(calories=0, protein_g=0, carbs_g=0, fat_g=-1)


def test_macros_zero_is_valid():
    m = Macros(calories=0, protein_g=0, carbs_g=0, fat_g=0)
    assert m.calories == 0


# ---- FoodLogCreate ----

def test_food_log_create_minimal():
    log = FoodLogCreate(
        date="2026-06-13",
        name="Apple",
        macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
    )
    assert log.source == "manual"
    assert log.serving == ""
    assert log.notes == ""


def test_food_log_create_all_sources():
    for src in ("ai_text", "ai_photo", "favorite", "manual"):
        log = FoodLogCreate(
            date="2026-06-13",
            name="Egg",
            macros=Macros(calories=70, protein_g=6, carbs_g=0, fat_g=5),
            source=src,
        )
        assert log.source == src


def test_food_log_create_invalid_date_pattern():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="13-06-2026",  # wrong format
            name="Apple",
            macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
        )


def test_food_log_create_invalid_date_no_dashes():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="20260613",
            name="Apple",
            macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
        )


def test_food_log_create_empty_name_rejected():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="2026-06-13",
            name="",
            macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
        )


def test_food_log_create_name_too_long_rejected():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="2026-06-13",
            name="x" * 121,
            macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
        )


def test_food_log_create_invalid_source():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="2026-06-13",
            name="Apple",
            macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
            source="barcode",
        )


# ---- FoodLogUpdate ----

def test_food_log_update_all_none():
    u = FoodLogUpdate()
    assert u.name is None
    assert u.macros is None


def test_food_log_update_partial():
    u = FoodLogUpdate(name="Banana", notes="post-workout")
    assert u.name == "Banana"
    assert u.macros is None


def test_food_log_update_rejects_negative_macro():
    with pytest.raises(ValidationError):
        FoodLogUpdate(macros=Macros(calories=-10, protein_g=0, carbs_g=0, fat_g=0))


# ---- FavoriteCreate ----

def test_favorite_create_minimal():
    fav = FavoriteCreate(
        name="Oats",
        macros=Macros(calories=300, protein_g=10, carbs_g=54, fat_g=5),
    )
    assert fav.serving == ""


def test_favorite_create_with_serving():
    fav = FavoriteCreate(
        name="Chicken breast",
        serving="150g",
        macros=Macros(calories=250, protein_g=46, carbs_g=0, fat_g=5),
    )
    assert fav.serving == "150g"


# ---- GoalsUpdate ----

def test_goals_update_valid():
    g = GoalsUpdate(calories=2200, protein_g=160, carbs_g=250, fat_g=70)
    assert g.calories == 2200


def test_goals_update_rejects_negative():
    with pytest.raises(ValidationError):
        GoalsUpdate(calories=-100, protein_g=160, carbs_g=250, fat_g=70)


def test_goals_update_zero_allowed():
    g = GoalsUpdate(calories=0, protein_g=0, carbs_g=0, fat_g=0)
    assert g.calories == 0
