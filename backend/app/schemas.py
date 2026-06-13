from typing import Literal

from pydantic import BaseModel, Field

Muscle = Literal[
    "chest", "back", "quads", "hamstrings", "glutes", "shoulders",
    "biceps", "triceps", "core", "calves", "forearms",
]
MovementPattern = Literal["push", "pull", "squat", "hinge", "carry", "core"]
Equipment = Literal["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"]


class ExerciseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    primary_muscles: list[Muscle] = Field(min_length=1)
    secondary_muscles: list[Muscle] = []
    movement_pattern: MovementPattern
    equipment: Equipment


class Exercise(ExerciseCreate):
    id: str
    user_id: str
    is_custom: bool
    images: list[str] = []
    instructions: list[str] = []
    difficulty: str | None = None


class SetEntry(BaseModel):
    weight: float = Field(ge=0)
    reps: int = Field(ge=0)
    rpe: float | None = Field(default=None, ge=1, le=10)
    is_warmup: bool = False


class WorkoutEntry(BaseModel):
    exercise_id: str
    exercise_name: str
    superset_group: str | None = None
    sets: list[SetEntry] = []


class WorkoutCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str = ""
    entries: list[WorkoutEntry] = []


class WorkoutUpdate(BaseModel):
    notes: str | None = None
    entries: list[WorkoutEntry] | None = None
