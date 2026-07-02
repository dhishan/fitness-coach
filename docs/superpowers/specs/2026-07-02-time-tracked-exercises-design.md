# Time-tracked exercises (isometric holds) - design

Status: approved (design), pending implementation plan
Date: 2026-07-02
Author: Dhishan + Claude

## Problem

Isometric holds (Plank, Wall Sit, Dead Hang, etc.) are logged with the same
WEIGHT x REPS tray as every other exercise. A plank is a duration, not reps, so
the current model records the wrong thing. The set-logging tray for Plank shows
WEIGHT (lb) and REPS steppers; it should record time.

Root cause: the data model has no concept of a time-tracked exercise.
`SetEntry` is `weight` + `reps` only, and `Exercise` has no tracking-type field,
so every exercise renders the same tray.

## Decisions (resolved during brainstorming)

1. A time-based set records **duration + optional added weight** (supports
   weighted planks / dead hangs). Reps is not used for time sets.
2. Scope: **auto-flag common isometric holds in the system catalog AND add a
   Reps/Time selector to the custom-exercise Add/Edit form** so users can mark
   their own exercises.
3. Stats: **PR = longest hold** (tie-break by added weight). Time sets are
   **excluded from the weight x reps volume total** (kept clean, not inflated).
4. The tracking type is **denormalized onto each workout entry** (like
   `exercise_name`), so historical sets stay correct even if the exercise is
   later edited or deleted.

## Data model

### Exercise (catalog)
Add to `ExerciseCreate` (backend `schemas.py`):
```python
Tracking = Literal["reps", "time"]
# on ExerciseCreate:
tracking: Tracking = "reps"   # default keeps all existing exercises on reps
```
Mirror in `packages/shared-types` / `frontend/src/types` / `mobile/src/types`:
```ts
export type Tracking = 'reps' | 'time'
// on Exercise: tracking: Tracking   (optional in TS reads; defaults 'reps')
```

### SetEntry
```python
class SetEntry(BaseModel):
    weight: float = Field(default=0, ge=0)   # 0 = bodyweight; >0 = added weight
    reps: int = Field(default=0, ge=0)        # 0 for time sets
    duration_s: int | None = Field(default=None, ge=0)  # set for time sets
    rpe: float | None = Field(default=None, ge=1, le=10)
    is_warmup: bool = False
```
A time set has `duration_s` set and `reps == 0`. A reps set has `duration_s is
None`. No validation forbids both; the client never produces both.

### WorkoutEntry
Denormalize the tracking type, mirroring `exercise_name`:
```python
class WorkoutEntry(BaseModel):
    exercise_id: str
    exercise_name: str
    tracking: Tracking = "reps"   # frozen at log time
    superset_group: str | None = None
    sets: list[SetEntry] = []
```
Backward compatible: old entries with no `tracking` field default to `"reps"`.

## Backend

- **Seed (`backend/app/seed/exercises.py`):** set `"tracking": "time"` on Plank
  (exists) and add the common missing holds: Side Plank, Wall Sit, Dead Hang,
  Hollow Body Hold, L-Sit. All other seed exercises stay reps (default).
- **PR detection (`workout_service.detect_prs`):** if `entry["tracking"] ==
  "time"`, the PR metric is the longest working-set `duration_s` (tie-break by
  added weight), compared against the historical best duration for that
  exercise. Otherwise unchanged (heaviest working set). `history_max_for` gains
  a parallel "best duration" lookup for time exercises.
- **Volume (`compute_total_volume`):** unchanged. Time sets have `reps == 0`, so
  `weight * reps == 0` - they contribute nothing. Add a comment making this
  explicit and skip time sets defensively.
- **MCP `log_workout` + chat tool executor:** accept `duration_s` on sets and
  `tracking` on entries; pass through unchanged.
- **Tests:** update `test_seed_catalog_shape` to allow `tracking`. Add units:
  longest-hold PR, weighted-hold tie-break, volume excludes time sets, schema
  round-trips `duration_s` / `tracking`.

## Clients (mobile + web, mirrored)

- **Set tray:** when `entry.tracking === 'time'`, the REPS stepper becomes a
  **DURATION** field (mm:ss display, +/- 15s steps, numeric entry in seconds),
  and the WEIGHT label reads "ADDED WEIGHT (unit)" and remains optional (0 =
  bodyweight). RPE, Warmup, "Log set & next" unchanged.
- **Set summary row / collapsed card summary / exercise history:** time sets
  render as duration - `1:00`, or `+10lb - 1:00` when added weight > 0. The
  "top set" surfaced in summaries becomes the **longest hold** for time
  exercises (instead of heaviest).
- **Add exercise to workout:** when building the in-memory entry, copy
  `tracking` from the chosen catalog exercise onto the entry.
- **Custom exercise Add/Edit form (`AddExerciseSheet` + Library, both
  platforms):** a Reps/Time segmented toggle that sets `tracking` on create.
- A shared time formatter (`formatDuration(seconds)` -> `m:ss`) added to each
  client's format utils.

## Migration & edge cases

- **Existing reps-based Plank sets are left untouched.** Display keys off
  `duration_s` presence: old sets (reps, no `duration_s`) still render as reps;
  new sets render as time. Non-destructive. No auto-convert (reps -> seconds is
  not reliable). The user can re-log if they want history as time.
- **Old workout entries** with no `tracking` field default to `"reps"` - no
  backfill required.
- **Deleted / re-typed catalog exercise:** irrelevant to logged sets, since
  `tracking` is stored on the entry.

## Out of scope

- Time-under-tension aggregate stat.
- Rest-timer / auto-count-up timer in the tray (manual entry only for now).
- Converting existing reps-based hold history to durations.

## Files touched (reference)

- `backend/app/schemas.py` - `Tracking`, `SetEntry.duration_s`,
  `WorkoutEntry.tracking`.
- `backend/app/seed/exercises.py` - flag/add isometric holds.
- `backend/app/services/workout_service.py` - PR + volume.
- `backend/app/mcp_server.py`, `backend/app/chat/tools/executor.py` - passthrough.
- `backend/tests/...` - seed shape + new units.
- `packages/shared-types/src/index.ts`, `frontend/src/types`, `mobile/src/types`.
- `mobile/app/(tabs)/workout.tsx`, exercise history, `AddExerciseSheet`, Library.
- `frontend/...` equivalents.
