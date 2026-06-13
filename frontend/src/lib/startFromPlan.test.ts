import { describe, expect, it } from 'vitest'
import { buildWorkoutEntries } from './startFromPlan'
import type { ExerciseHistoryItem, TemplateEntry } from '@fitness/shared-types'

const entry = (
  exercise_id: string,
  target_sets = 3,
  superset_group?: string | null,
): TemplateEntry => ({
  exercise_id,
  exercise_name: `Exercise ${exercise_id}`,
  target_sets,
  superset_group: superset_group ?? null,
})

const histItem = (
  _exercise_id: string,
  sets: { weight: number; reps: number; is_warmup?: boolean }[],
): ExerciseHistoryItem => ({
  workout_id: 'wk-1',
  date: '2026-06-01',
  sets: sets.map((s) => ({ weight: s.weight, reps: s.reps, is_warmup: s.is_warmup ?? false })),
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
})
