import pytest
from pydantic import ValidationError

from app.schemas import (
    FavoriteCreate,
    FoodLogCreate,
    FoodLogUpdate,
    GoalsUpdate,
    Macros,
    Micros,
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
    for src in ("ai_text", "ai_photo", "favorite", "manual", "barcode"):
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
            source="unknown_source",
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


def test_goals_update_micros_targets_optional():
    g = GoalsUpdate(calories=2000, protein_g=150, carbs_g=200, fat_g=60)
    assert g.micros_targets is None


def test_goals_update_with_micros_targets():
    from app.schemas import Micros
    g = GoalsUpdate(
        calories=2000, protein_g=150, carbs_g=200, fat_g=60,
        micros_targets=Micros(fiber_g=30, sodium_mg=2300),
    )
    assert g.micros_targets.fiber_g == 30
    assert g.micros_targets.sodium_mg == 2300


# ---- Micros ----

def test_micros_defaults_to_zero():
    m = Micros()
    assert m.fiber_g == 0
    assert m.sugar_g == 0
    assert m.sodium_mg == 0
    assert m.potassium_mg == 0
    assert m.calcium_mg == 0
    assert m.iron_mg == 0
    assert m.vitamin_c_mg == 0
    assert m.vitamin_d_mcg == 0
    assert m.saturated_fat_g == 0
    assert m.cholesterol_mg == 0


def test_micros_rejects_negative_fiber():
    with pytest.raises(ValidationError):
        Micros(fiber_g=-1)


def test_micros_rejects_negative_sodium():
    with pytest.raises(ValidationError):
        Micros(sodium_mg=-0.1)


def test_micros_partial_set():
    m = Micros(fiber_g=5.5, sodium_mg=400)
    assert m.fiber_g == 5.5
    assert m.sodium_mg == 400
    assert m.sugar_g == 0


# ---- FoodLogCreate new fields ----

def test_food_log_create_backward_compat():
    """Existing clients that don't send new fields still work."""
    log = FoodLogCreate(
        date="2026-06-13",
        name="Apple",
        macros=Macros(calories=95, protein_g=0.5, carbs_g=25.0, fat_g=0.3),
    )
    assert log.meal_type is None
    assert log.logged_at is None
    assert log.micros is None
    assert log.usda_fdc_id is None
    assert log.micros_source is None


def test_food_log_create_meal_type_valid():
    for mt in ("breakfast", "lunch", "dinner", "snack"):
        log = FoodLogCreate(
            date="2026-06-13",
            name="Meal",
            macros=Macros(calories=300, protein_g=20, carbs_g=30, fat_g=10),
            meal_type=mt,
        )
        assert log.meal_type == mt


def test_food_log_create_meal_type_invalid():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="2026-06-13",
            name="Meal",
            macros=Macros(calories=300, protein_g=20, carbs_g=30, fat_g=10),
            meal_type="brunch",
        )


def test_food_log_create_with_micros():
    log = FoodLogCreate(
        date="2026-06-13",
        name="Oatmeal",
        macros=Macros(calories=300, protein_g=10, carbs_g=54, fat_g=5),
        micros=Micros(fiber_g=4, sugar_g=1, sodium_mg=5),
        micros_source="ai",
        usda_fdc_id=123456,
    )
    assert log.micros.fiber_g == 4
    assert log.micros_source == "ai"
    assert log.usda_fdc_id == 123456


def test_food_log_create_micros_source_usda():
    log = FoodLogCreate(
        date="2026-06-13",
        name="Chicken",
        macros=Macros(calories=165, protein_g=31, carbs_g=0, fat_g=3.6),
        micros=Micros(sodium_mg=74),
        micros_source="usda",
    )
    assert log.micros_source == "usda"


def test_food_log_create_micros_source_invalid():
    with pytest.raises(ValidationError):
        FoodLogCreate(
            date="2026-06-13",
            name="Chicken",
            macros=Macros(calories=165, protein_g=31, carbs_g=0, fat_g=3.6),
            micros_source="database",
        )


# ---- FoodLogUpdate new fields ----

def test_food_log_update_new_fields_all_none():
    u = FoodLogUpdate()
    assert u.meal_type is None
    assert u.logged_at is None
    assert u.micros is None
    assert u.usda_fdc_id is None
    assert u.micros_source is None


def test_food_log_update_with_new_fields():
    u = FoodLogUpdate(
        meal_type="dinner",
        micros=Micros(fiber_g=3),
        micros_source="usda",
        usda_fdc_id=789,
    )
    assert u.meal_type == "dinner"
    assert u.micros.fiber_g == 3
    assert u.micros_source == "usda"
    assert u.usda_fdc_id == 789
