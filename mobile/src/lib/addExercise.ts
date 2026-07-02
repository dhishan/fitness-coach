// mirror of frontend/src/lib/addExercise.ts

import type { Exercise, ExerciseHistoryItem, SetEntry, WorkoutEntry } from '@fitness/shared-types'
import { formatLastTime } from './workoutHelpers'

export interface EntryWithHistory extends WorkoutEntry {
  lastTime?: string
}

/**
 * Build a new WorkoutEntry (with prefilled sets from history) for a given exercise.
 * Pure function - no side-effects, no API calls.
 */
export function buildEntryFromHistory(
  exercise: Exercise,
  hist: ExerciseHistoryItem[],
  unit: 'kg' | 'lb' = 'kg',
): EntryWithHistory {
  const lastSession = hist[0]
  let prefilled: SetEntry[]
  let lastTime: string | undefined

  const isTime = exercise.tracking === 'time'

  if (lastSession && lastSession.sets.length > 0) {
    prefilled = lastSession.sets
      .filter((s) => !s.is_warmup)
      .map((s) =>
        isTime
          ? { weight: s.weight, reps: 0, duration_s: s.duration_s ?? 0, is_warmup: false as const }
          : { weight: s.weight, reps: s.reps, is_warmup: false as const },
      )
    if (prefilled.length === 0)
      prefilled = [isTime ? { weight: 0, reps: 0, duration_s: 0 } : { weight: 0, reps: 0 }]
    lastTime = formatLastTime(lastSession.sets, lastSession.date, undefined, unit)
  } else {
    prefilled = [isTime ? { weight: 0, reps: 0, duration_s: 0 } : { weight: 0, reps: 0 }]
    lastTime = undefined
  }

  return {
    exercise_id: exercise.id,
    exercise_name: exercise.name,
    tracking: exercise.tracking ?? 'reps',
    superset_group: null,
    sets: prefilled,
    lastTime,
  }
}
