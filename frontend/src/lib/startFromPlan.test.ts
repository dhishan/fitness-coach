import { describe, expect, it } from 'vitest'
import { buildWorkoutEntries } from './startFromPlan'
import type { ExerciseHistoryItem, TemplateEntry } from '@fitness/shared-types'

const entry = (
  exercise_id: string,
  target_sets = 3,
  superset_group?: string | null,
  tracking?: 'reps' | 'time',
): TemplateEntry => ({
  exercise_id,
  exercise_name: `Exercise ${exercise_id}`,
  target_sets,
  superset_group: superset_group ?? null,
  ...(tracking ? { tracking } : {}),
})

const histItem = (
  _exercise_id: string,
  sets: { weight: number; reps: number; is_warmup?: boolean; duration_s?: number }[],
): ExerciseHistoryItem => ({
  workout_id: 'wk-1',
  date: '2026-06-01',
  sets: sets.map((s) => ({
    weight: s.weight,
    reps: s.reps,
    is_warmup: s.is_warmup ?? false,
    ...(s.duration_s !== undefined ? { duration_s: s.duration_s } : {}),
  })),
})

describe('buildWorkoutEntries', () => {
  it('returns empty array for empty template', () => {
    expect(buildWorkoutEntries([], {})).toEqual([])
  })

  it('prefills working sets from history when available', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 3)],
      {
        ex1: [histItem('ex1', [
          { weight: 100, reps: 5 },
          { weight: 100, reps: 5 },
        ])],
      },
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].sets).toEqual([
      { weight: 100, reps: 5, is_warmup: false },
      { weight: 100, reps: 5, is_warmup: false },
    ])
  })

  it('strips warmup sets from history, keeps working sets', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 3)],
      {
        ex1: [histItem('ex1', [
          { weight: 60, reps: 10, is_warmup: true },
          { weight: 100, reps: 5 },
          { weight: 100, reps: 5 },
        ])],
      },
    )
    expect(entries[0].sets).toHaveLength(2)
    expect(entries[0].sets.every((s) => !s.is_warmup)).toBe(true)
  })

  it('falls back to target_sets empty rows when history has only warmups', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 4)],
      {
        ex1: [histItem('ex1', [
          { weight: 60, reps: 10, is_warmup: true },
        ])],
      },
    )
    expect(entries[0].sets).toHaveLength(4)
    expect(entries[0].sets).toEqual(
      Array.from({ length: 4 }, () => ({ weight: 0, reps: 0 })),
    )
  })

  it('falls back to target_sets empty rows when no history', () => {
    const entries = buildWorkoutEntries([entry('ex1', 3)], {})
    expect(entries[0].sets).toHaveLength(3)
    expect(entries[0].sets).toEqual(
      Array.from({ length: 3 }, () => ({ weight: 0, reps: 0 })),
    )
  })

  it('carries superset_group from template entry', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 3, '1'), entry('ex2', 3, '1')],
      {},
    )
    expect(entries[0].superset_group).toBe('1')
    expect(entries[1].superset_group).toBe('1')
  })

  it('sets superset_group null when not specified', () => {
    const entries = buildWorkoutEntries([entry('ex1', 3)], {})
    expect(entries[0].superset_group).toBeNull()
  })

  it('handles multiple exercises with mixed history', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 3), entry('ex2', 2), entry('ex3', 5)],
      {
        ex1: [histItem('ex1', [{ weight: 80, reps: 8 }, { weight: 80, reps: 8 }])],
        // ex2 has no history
        ex3: [histItem('ex3', [{ weight: 0, reps: 15 }])],
      },
    )
    expect(entries[0].sets).toHaveLength(2)
    expect(entries[0].sets[0].weight).toBe(80)
    expect(entries[1].sets).toHaveLength(2)
    expect(entries[1].sets).toEqual([{ weight: 0, reps: 0 }, { weight: 0, reps: 0 }])
    expect(entries[2].sets).toHaveLength(1)
    expect(entries[2].sets[0]).toEqual({ weight: 0, reps: 15, is_warmup: false })
  })

  it('time exercise via entry.tracking: sets have duration_s, reps=0, tracking="time"', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 3, null, 'time')],
      {
        ex1: [histItem('ex1', [
          { weight: 10, reps: 0, duration_s: 60 },
          { weight: 10, reps: 0, duration_s: 55 },
        ])],
      },
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].tracking).toBe('time')
    expect(entries[0].sets).toEqual([
      { weight: 10, reps: 0, duration_s: 60, is_warmup: false },
      { weight: 10, reps: 0, duration_s: 55, is_warmup: false },
    ])
  })

  it('time exercise inferred from history: sets have duration_s, tracking="time"', () => {
    // entry.tracking is not set but history contains duration_s > 0
    const entries = buildWorkoutEntries(
      [entry('ex1', 3)],
      {
        ex1: [histItem('ex1', [
          { weight: 0, reps: 0, duration_s: 90 },
          { weight: 0, reps: 0, duration_s: 85 },
        ])],
      },
    )
    expect(entries[0].tracking).toBe('time')
    expect(entries[0].sets).toHaveLength(2)
    expect(entries[0].sets[0]).toEqual({ weight: 0, reps: 0, duration_s: 90, is_warmup: false })
    expect(entries[0].sets[1]).toEqual({ weight: 0, reps: 0, duration_s: 85, is_warmup: false })
  })

  it('time exercise with no history falls back to single empty time set', () => {
    const entries = buildWorkoutEntries(
      [entry('ex1', 3, null, 'time')],
      {},
    )
    expect(entries[0].tracking).toBe('time')
    expect(entries[0].sets).toHaveLength(1)
    expect(entries[0].sets[0]).toEqual({ weight: 0, reps: 0, duration_s: 0, is_warmup: false })
  })

  it('reps exercise returns tracking="reps"', () => {
    const entries = buildWorkoutEntries([entry('ex1', 3)], {})
    expect(entries[0].tracking).toBe('reps')
  })
})
