"""
Unit tests for the pure mapping functions in import_free_exercise_db.

No network calls, no Firestore — only the mapping logic.
"""
import sys
from pathlib import Path

# Allow importing from scripts/ without installing it as a package
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from import_free_exercise_db import (
    MUSCLE_MAP,
    map_muscles,
    map_equipment,
    pattern_for,
)


# ---------------------------------------------------------------------------
# MUSCLE_MAP coverage
# ---------------------------------------------------------------------------

class TestMuscleMapCoverage:
    """Verify all 9 example source muscles from the spec map correctly."""

    def test_quadriceps_maps_to_quads(self):
        assert MUSCLE_MAP["quadriceps"] == "quads"

    def test_abdominals_maps_to_core(self):
        assert MUSCLE_MAP["abdominals"] == "core"

    def test_lats_maps_to_back(self):
        assert MUSCLE_MAP["lats"] == "back"

    def test_middle_back_maps_to_back(self):
        assert MUSCLE_MAP["middle back"] == "back"

    def test_lower_back_maps_to_back(self):
        assert MUSCLE_MAP["lower back"] == "back"

    def test_traps_maps_to_back(self):
        assert MUSCLE_MAP["traps"] == "back"

    def test_abductors_maps_to_glutes(self):
        assert MUSCLE_MAP["abductors"] == "glutes"

    def test_adductors_maps_to_glutes(self):
        assert MUSCLE_MAP["adductors"] == "glutes"

    def test_neck_is_not_in_muscle_map(self):
        """Neck should be absent from MUSCLE_MAP so it is dropped silently."""
        assert "neck" not in MUSCLE_MAP

    def test_map_muscles_drops_neck(self):
        result = map_muscles(["neck", "quadriceps"])
        assert "neck" not in result
        assert "quads" in result

    def test_map_muscles_deduplicates(self):
        """lats and middle back both map to back — result should have back once."""
        result = map_muscles(["lats", "middle back"])
        assert result.count("back") == 1

    def test_map_muscles_empty_list(self):
        assert map_muscles([]) == []

    def test_map_muscles_all_unmappable(self):
        assert map_muscles(["neck"]) == []


# ---------------------------------------------------------------------------
# Equipment mapping
# ---------------------------------------------------------------------------

class TestEquipmentMapping:
    def test_barbell(self):
        assert map_equipment("barbell") == "barbell"

    def test_dumbbell(self):
        assert map_equipment("dumbbell") == "dumbbell"

    def test_machine(self):
        assert map_equipment("machine") == "machine"

    def test_cable(self):
        assert map_equipment("cable") == "cable"

    def test_body_only_maps_to_bodyweight(self):
        assert map_equipment("body only") == "bodyweight"

    def test_kettlebells_maps_to_other(self):
        assert map_equipment("kettlebells") == "other"

    def test_bands_maps_to_other(self):
        assert map_equipment("bands") == "other"

    def test_medicine_ball_maps_to_other(self):
        assert map_equipment("medicine ball") == "other"

    def test_exercise_ball_maps_to_other(self):
        assert map_equipment("exercise ball") == "other"

    def test_foam_roll_maps_to_other(self):
        assert map_equipment("foam roll") == "other"

    def test_none_maps_to_other(self):
        assert map_equipment(None) == "other"

    def test_unknown_maps_to_other(self):
        assert map_equipment("resistance band") == "other"

    def test_case_insensitive(self):
        assert map_equipment("Barbell") == "barbell"


# ---------------------------------------------------------------------------
# pattern_for
# ---------------------------------------------------------------------------

class TestPatternFor:
    def test_bench_press_is_push(self):
        """Chest primary + force=push -> push."""
        result = pattern_for(
            category="Chest",
            primary_muscles=["chest", "triceps"],
            name="Barbell Bench Press",
            force="push",
        )
        assert result == "push"

    def test_barbell_row_is_pull(self):
        """Back primary + force=pull -> pull."""
        result = pattern_for(
            category="Back",
            primary_muscles=["back"],
            name="Barbell Row",
            force="pull",
        )
        assert result == "pull"

    def test_back_squat_is_squat(self):
        """Primary quads always -> squat regardless of name."""
        result = pattern_for(
            category="Legs",
            primary_muscles=["quads", "glutes"],
            name="Barbell Back Squat",
            force="push",
        )
        assert result == "squat"

    def test_leg_press_is_squat(self):
        result = pattern_for(
            category="Legs",
            primary_muscles=["quads"],
            name="Leg Press",
            force="push",
        )
        assert result == "squat"

    def test_romanian_deadlift_is_hinge(self):
        """Primary hamstrings + 'deadlift' in name -> hinge."""
        result = pattern_for(
            category="Legs",
            primary_muscles=["hamstrings", "glutes"],
            name="Romanian Deadlift",
            force="pull",
        )
        assert result == "hinge"

    def test_hip_thrust_is_hinge(self):
        """Primary glutes + 'thrust' in name -> hinge."""
        result = pattern_for(
            category="Legs",
            primary_muscles=["glutes"],
            name="Hip Thrust",
            force="push",
        )
        assert result == "hinge"

    def test_kettlebell_swing_is_hinge(self):
        result = pattern_for(
            category="Legs",
            primary_muscles=["hamstrings", "glutes"],
            name="Kettlebell Swing",
            force=None,
        )
        assert result == "hinge"

    def test_plank_is_core(self):
        """Primary core -> core."""
        result = pattern_for(
            category="Abdominals",
            primary_muscles=["core"],
            name="Plank",
            force="static",
        )
        assert result == "core"

    def test_cable_crunch_core_category(self):
        result = pattern_for(
            category="core",
            primary_muscles=["core"],
            name="Cable Crunch",
            force="pull",
        )
        assert result == "core"

    def test_stretching_category_returns_none(self):
        result = pattern_for(
            category="Stretching",
            primary_muscles=["hamstrings"],
            name="Standing Hamstring Stretch",
            force=None,
        )
        assert result is None

    def test_cardio_category_returns_none(self):
        result = pattern_for(
            category="Cardio",
            primary_muscles=["quads"],
            name="Cycling",
            force=None,
        )
        assert result is None

    def test_carry_in_name_is_carry(self):
        result = pattern_for(
            category="Other",
            primary_muscles=["forearms", "core"],
            name="Farmer's Carry",
            force=None,
        )
        assert result == "carry"

    def test_farmer_in_name_is_carry(self):
        result = pattern_for(
            category="Other",
            primary_muscles=["forearms"],
            name="Farmer Walk",
            force=None,
        )
        assert result == "carry"

    def test_no_mappable_path_returns_none(self):
        """Unknown category, no force, primary muscles that don't hit a rule."""
        result = pattern_for(
            category="Unknown",
            primary_muscles=["shoulders"],
            name="Some Weird Move",
            force=None,
        )
        assert result is None

    def test_glutes_without_hinge_keyword_returns_none_for_legs_category(self):
        """Glutes + category=Legs + no hinge keyword -> skip (ambiguous)."""
        result = pattern_for(
            category="Legs",
            primary_muscles=["glutes"],
            name="Glute Kickback",
            force=None,
        )
        assert result is None
