import type { ExerciseHistoryItem, TemplateEntry, WorkoutEntry, WorkoutTemplate } from '@fitness/shared-types'
import { exercisesApi, workoutsApi } from '../services/api'
import { toLocalISODate } from './dates'

/**
 * Pure function: given template entries and a map of exercise history (keyed by
 * exercise_id), produce WorkoutEntry[] ready to save on a workout.
 *
 * - If history exists: use the working sets (is_warmup === false/undefined)
 *   from the most recent session.  If those are all warmups, fall back to
 *   target_sets empty rows (or a single time-set for time exercises).
 * - If no history: target_sets empty rows {weight:0, reps:0} for reps, or a
 *   single {weight:0, reps:0, duration_s:0} for time exercises.
 * - isTime is true when entry.tracking === 'time' OR the last session's working
 *   sets have duration_s set (inferred from history).
 * - superset_group is carried over as-is.
 * - Returned entry includes tracking: 'time' | 'reps'.
 */
export function buildWorkoutEntries(
  templateEntries: TemplateEntry[],
  historyByExerciseId: Record<string, ExerciseHistoryItem[]>,
): WorkoutEntry[] {
  return templateEntries.map((entry) => {
    const hist = historyByExerciseId[entry.exercise_id] ?? []
    const lastSession = hist[0]

    let sets: WorkoutEntry['sets']

    // Determine tracking mode: explicit template field OR inferred from history
    const fromTemplate = entry.tracking === 'time'
    const fromHistory =
      lastSession != null &&
      lastSession.sets
        .filter((s) => !s.is_warmup)
        .some((s) => s.duration_s != null && s.duration_s > 0)
    const isTime = fromTemplate || fromHistory

    if (lastSession && lastSession.sets.length > 0) {
      const workingSets = lastSession.sets.filter((s) => !s.is_warmup)
      if (workingSets.length > 0) {
        sets = workingSets.map((s) =>
          isTime
            ? { weight: s.weight ?? 0, reps: 0, duration_s: s.duration_s ?? 0, is_warmup: false }
            : { weight: s.weight ?? 0, reps: s.reps ?? 0, is_warmup: false },
        )
      } else {
        // only warmups in history - fall back to empty sets
        sets = isTime
          ? [{ weight: 0, reps: 0, duration_s: 0, is_warmup: false }]
          : Array.from({ length: entry.target_sets }, () => ({ weight: 0, reps: 0 }))
      }
    } else {
      sets = isTime
        ? [{ weight: 0, reps: 0, duration_s: 0, is_warmup: false }]
        : Array.from({ length: entry.target_sets }, () => ({ weight: 0, reps: 0 }))
    }

    return {
      exercise_id: entry.exercise_id,
      exercise_name: entry.exercise_name,
      tracking: isTime ? 'time' : 'reps',
      superset_group: entry.superset_group ?? null,
      sets,
    }
  })
}

/**
 * Orchestration: create a workout for today, prefill from history, return workout id.
 */
export async function startFromPlan(
  template: WorkoutTemplate,
  intent?: { goal: string; energy: number | null; mental: number | null; physical: number | null },
): Promise<string> {
  const workout = await workoutsApi.create({ date: toLocalISODate(), intent })

  const historyResults = await Promise.all(
    template.entries.map((entry) =>
      exercisesApi.history(entry.exercise_id, 1).catch(() => [] as ExerciseHistoryItem[]),
    ),
  )

  const historyByExerciseId: Record<string, ExerciseHistoryItem[]> = {}
  template.entries.forEach((entry, i) => {
    historyByExerciseId[entry.exercise_id] = historyResults[i]
  })

  const entries = buildWorkoutEntries(template.entries, historyByExerciseId)
  await workoutsApi.update(workout.id, { entries })

  return workout.id
}
