import type { ExerciseHistoryItem, TemplateEntry, WorkoutEntry, WorkoutTemplate } from '@fitness/shared-types'
import { exercisesApi, workoutsApi } from '../services/api'
import { toLocalISODate } from './dates'

/**
 * Pure function: given template entries and a map of exercise history (keyed by
 * exercise_id), produce WorkoutEntry[] ready to save on a workout.
 *
 * - If history exists: use the working sets (is_warmup === false/undefined)
 *   from the most recent session.  If those are all warmups, fall back to
 *   target_sets empty rows.
 * - If no history: target_sets empty rows {weight:0, reps:0}.
 * - superset_group is carried over as-is.
 */
export function buildWorkoutEntries(
  templateEntries: TemplateEntry[],
  historyByExerciseId: Record<string, ExerciseHistoryItem[]>,
): WorkoutEntry[] {
  return templateEntries.map((entry) => {
    const hist = historyByExerciseId[entry.exercise_id] ?? []
    const lastSession = hist[0]

    let sets: WorkoutEntry['sets']

    if (lastSession && lastSession.sets.length > 0) {
      const workingSets = lastSession.sets.filter((s) => !s.is_warmup)
      if (workingSets.length > 0) {
        sets = workingSets.map((s) => ({ weight: s.weight, reps: s.reps, is_warmup: false }))
      } else {
        sets = Array.from({ length: entry.target_sets }, () => ({ weight: 0, reps: 0 }))
      }
    } else {
      sets = Array.from({ length: entry.target_sets }, () => ({ weight: 0, reps: 0 }))
    }

    return {
      exercise_id: entry.exercise_id,
      exercise_name: entry.exercise_name,
      superset_group: entry.superset_group ?? null,
      sets,
    }
  })
}

/**
 * Orchestration: create a workout for today, prefill from history, return workout id.
 */
export async function startFromPlan(template: WorkoutTemplate): Promise<string> {
  const workout = await workoutsApi.create({ date: toLocalISODate() })

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
