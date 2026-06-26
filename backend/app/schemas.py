from typing import Literal, Optional

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


class SessionIntent(BaseModel):
    """Subjective state captured at the start of a session."""
    goal: str = Field(default="", max_length=200)
    energy: int | None = Field(default=None, ge=1, le=10)
    mental: int | None = Field(default=None, ge=1, le=10)
    physical: int | None = Field(default=None, ge=1, le=10)


class WorkoutCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str = ""
    entries: list[WorkoutEntry] = []
    intent: SessionIntent | None = None


class WorkoutUpdate(BaseModel):
    notes: str | None = None
    entries: list[WorkoutEntry] | None = None
    intent: SessionIntent | None = None


class TemplateEntry(BaseModel):
    exercise_id: str
    exercise_name: str
    target_sets: int = Field(ge=1, le=20, default=3)
    superset_group: str | None = None


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    entries: list[TemplateEntry] = []


class TemplateUpdate(BaseModel):
    name: str | None = None
    entries: list[TemplateEntry] | None = None


# ---- Nutrition ----

class Macros(BaseModel):
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)


class Micros(BaseModel):
    fiber_g: float = Field(default=0, ge=0)
    sugar_g: float = Field(default=0, ge=0)
    sodium_mg: float = Field(default=0, ge=0)
    potassium_mg: float = Field(default=0, ge=0)
    calcium_mg: float = Field(default=0, ge=0)
    iron_mg: float = Field(default=0, ge=0)
    vitamin_c_mg: float = Field(default=0, ge=0)
    vitamin_d_mcg: float = Field(default=0, ge=0)
    saturated_fat_g: float = Field(default=0, ge=0)
    cholesterol_mg: float = Field(default=0, ge=0)


MealType = Literal["breakfast", "lunch", "dinner", "snack"]


class FoodLogCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=300)
    serving: str = ""
    macros: Macros
    source: Literal["ai_text", "ai_photo", "favorite", "manual", "barcode"] = "manual"
    notes: str = ""
    meal_type: Optional[MealType] = None
    logged_at: str | None = None
    micros: Micros | None = None
    usda_fdc_id: int | None = None
    micros_source: Optional[Literal["ai", "usda", "label"]] = None


class FoodLogUpdate(BaseModel):
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str | None = None
    description: str | None = None
    serving: str | None = None
    macros: Macros | None = None
    notes: str | None = None
    meal_type: Optional[MealType] = None
    logged_at: str | None = None
    micros: Micros | None = None
    usda_fdc_id: int | None = None
    micros_source: Optional[Literal["ai", "usda", "label"]] = None


class DayStatusUpdate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    incomplete: bool


class FavoriteCreate(BaseModel):
    name: str
    serving: str = ""
    macros: Macros
    # Per-serving micros, stored so re-logging a saved food keeps its micros.
    micros: Micros | None = None
    micros_source: Optional[Literal["ai", "usda", "label"]] = None


class RecipeIngredient(BaseModel):
    """One ingredient in a recipe.

    Values are entered straight off the nutrition label — per serving — and
    multiplied by how many servings the user used. Matches how labels actually
    read (1 scoop / 1 cup / 1 tbsp etc., each with its own gram weight).
    """
    name: str = Field(min_length=1, max_length=120)
    serving_label: str = Field(default="1 serving", max_length=40)
    servings_used: float = Field(default=1.0, gt=0)
    # Per single serving — what one serving_label contributes
    calories_per_serving: float = Field(default=0, ge=0)
    protein_g_per_serving: float = Field(default=0, ge=0)
    carbs_g_per_serving: float = Field(default=0, ge=0)
    fat_g_per_serving: float = Field(default=0, ge=0)
    # Per-serving micros (optional — defaults to 0 when unknown)
    fiber_g_per_serving: float = Field(default=0, ge=0)
    sugar_g_per_serving: float = Field(default=0, ge=0)
    sodium_mg_per_serving: float = Field(default=0, ge=0)
    potassium_mg_per_serving: float = Field(default=0, ge=0)
    calcium_mg_per_serving: float = Field(default=0, ge=0)
    iron_mg_per_serving: float = Field(default=0, ge=0)
    vitamin_c_mg_per_serving: float = Field(default=0, ge=0)
    vitamin_d_mcg_per_serving: float = Field(default=0, ge=0)
    saturated_fat_g_per_serving: float = Field(default=0, ge=0)
    cholesterol_mg_per_serving: float = Field(default=0, ge=0)
    usda_fdc_id: int | None = None


class RecipeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    yields_servings: float = Field(default=1.0, gt=0)
    ingredients: list[RecipeIngredient] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=1000)


class RecipeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    yields_servings: float | None = Field(default=None, gt=0)
    ingredients: list[RecipeIngredient] | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=1000)


class RecipeLogRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    servings_eaten: float = Field(gt=0, le=20)
    meal_type: Optional[MealType] = None
    logged_at: str | None = None


class GoalsUpdate(BaseModel):
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    micros_targets: Micros | None = None


# ---- Body Metrics ----

class BodyMetricCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    weight_kg: float = Field(gt=0, le=400)
    body_fat_pct: float | None = Field(default=None, ge=2, le=70)
    waist_cm: float | None = Field(default=None, ge=20, le=300)
    chest_cm: float | None = Field(default=None, ge=20, le=300)
    arm_cm: float | None = Field(default=None, ge=10, le=100)
    thigh_cm: float | None = Field(default=None, ge=10, le=200)
    photo_urls: list[str] = []
    notes: str = ""


class BodyMetricUpdate(BaseModel):
    weight_kg: float | None = Field(default=None, gt=0, le=400)
    body_fat_pct: float | None = None
    waist_cm: float | None = None
    chest_cm: float | None = None
    arm_cm: float | None = None
    thigh_cm: float | None = None
    photo_urls: list[str] | None = None
    notes: str | None = None


# ---- Cardio ----

CardioType = Literal["run", "ride", "walk", "swim", "other"]


class CardioLogCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    type: CardioType
    duration_s: int = Field(ge=0)
    distance_m: float = Field(default=0, ge=0)
    avg_hr: int | None = Field(default=None, ge=20, le=240)
    calories: int | None = Field(default=None, ge=0)
    notes: str = ""
    source: Literal["manual", "healthkit"] = "manual"
    external_id: str | None = None


class CardioLogUpdate(BaseModel):
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    type: CardioType | None = None
    duration_s: int | None = Field(default=None, ge=0)
    distance_m: float | None = Field(default=None, ge=0)
    avg_hr: int | None = Field(default=None, ge=20, le=240)
    calories: int | None = Field(default=None, ge=0)
    notes: str | None = None


# ---- HealthKit ----

class HealthKitSample(BaseModel):
    """Single normalized sample posted by the mobile app."""
    kind: Literal["weight", "steps", "workout", "hrv", "sleep"]
    external_id: str
    date: str
    started_at: str | None = None
    ended_at: str | None = None
    value: float | None = None
    workout_type: str | None = None
    duration_s: int | None = None
    distance_m: float | None = None
    avg_hr: int | None = Field(default=None, ge=20, le=240)
    calories: int | None = None


class HealthKitBatch(BaseModel):
    samples: list[HealthKitSample]
