import pytest
from pydantic import ValidationError


def test_exercise_create_validates_muscles_and_pattern():
    from app.schemas import ExerciseCreate
    e = ExerciseCreate(name="Bench Press", primary_muscles=["chest", "triceps"],
                       movement_pattern="push", equipment="barbell")
    assert e.secondary_muscles == []
    with pytest.raises(ValidationError):
        ExerciseCreate(name="X", primary_muscles=["wings"], movement_pattern="push", equipment="barbell")
    with pytest.raises(ValidationError):
        ExerciseCreate(name="X", primary_muscles=["chest"], movement_pattern="yeet", equipment="barbell")


def test_workout_entry_defaults():
    from app.schemas import WorkoutEntry, SetEntry
    w = WorkoutEntry(exercise_id="e1", exercise_name="Bench Press",
                     sets=[SetEntry(weight=80, reps=5)])
    assert w.superset_group is None
    assert w.sets[0].is_warmup is False
    assert w.sets[0].rpe is None
