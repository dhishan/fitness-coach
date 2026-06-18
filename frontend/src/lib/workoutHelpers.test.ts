import { describe, it, expect } from 'vitest'
import { formatLastTime, nextSupersetGroup, reorderEntries } from './workoutHelpers'
import type { SetEntry, WorkoutEntry } from '@fitness/shared-types'

// ---------------------------------------------------------------------------
// formatLastTime
// ---------------------------------------------------------------------------

const workingSets: SetEntry[] = [
  { weight: 80, reps: 5, is_warmup: false },
  { weight: 80, reps: 5, is_warmup: false },
  { weight: 80, reps: 4, is_warmup: false },
]

const withWarmup: SetEntry[] = [
  { weight: 40, reps: 10, is_warmup: true },  // warmup — excluded
  { weight: 80, reps: 5, is_warmup: false },
  { weight: 80, reps: 5, is_warmup: false },
]

describe('formatLastTime', () => {
  it('returns empty string when no sets', () => {
    expect(formatLastTime([], '2026-06-09', '2026-06-12')).toBe('')
  })

  it('formats working sets as weight and rep counts, relative days', () => {
    // 3 days ago
    const result = formatLastTime(workingSets, '2026-06-09', '2026-06-12')
    expect(result).toBe('80kg 5/5/4, 3d ago')
  })

  it('excludes warmup sets from the summary', () => {
    const result = formatLastTime(withWarmup, '2026-06-09', '2026-06-12')
    expect(result).toBe('80kg 5/5, 3d ago')
  })

  it('shows "today" when date matches today', () => {
    const result = formatLastTime(workingSets, '2026-06-12', '2026-06-12')
    expect(result).toBe('80kg 5/5/4, today')
  })

  it('shows "1d ago" when one day apart', () => {
    const result = formatLastTime(workingSets, '2026-06-11', '2026-06-12')
    expect(result).toBe('80kg 5/5/4, 1d ago')
  })

  it('uses distinct weights when sets vary', () => {
    const variedSets: SetEntry[] = [
      { weight: 80, reps: 5, is_warmup: false },
      { weight: 85, reps: 3, is_warmup: false },
    ]
    // Weight shown is the most common, or first working weight
    // Spec says "80kg 5/5/4" style — weight is shown once, reps separated by /
    // When weights differ, show weight of first working set
    const result = formatLastTime(variedSets, '2026-06-09', '2026-06-12')
    expect(result).toBe('80kg 5/3, 3d ago')
  })

  it('defaults today to current date when not provided', () => {
    // Just check it returns a non-empty string and does not throw
    const result = formatLastTime(workingSets, '2026-06-09')
    expect(typeof result).toBe('string')
    expect(result).toContain('80kg 5/5/4')
  })
})

// ---------------------------------------------------------------------------
// nextSupersetGroup
// ---------------------------------------------------------------------------

function makeEntries(groups: (string | null | undefined)[]): WorkoutEntry[] {
  return groups.map((g, i) => ({
    exercise_id: `ex-${i}`,
    exercise_name: `Exercise ${i}`,
    superset_group: g ?? null,
    sets: [],
  }))
}

describe('nextSupersetGroup', () => {
  it('returns "1" when no entries have a superset group', () => {
    const entries = makeEntries([null, null])
    expect(nextSupersetGroup(entries)).toBe('1')
  })

  it('returns the next unused integer string', () => {
    const entries = makeEntries(['1', '1', null])
    expect(nextSupersetGroup(entries)).toBe('2')
  })

  it('fills gaps — returns smallest unused', () => {
    // "1" and "3" used; "2" is missing
    const entries = makeEntries(['1', '3', null])
    expect(nextSupersetGroup(entries)).toBe('2')
  })

  it('handles entries with no superset_group property at all', () => {
    const entries: WorkoutEntry[] = [
      { exercise_id: 'a', exercise_name: 'A', sets: [] },
    ]
    expect(nextSupersetGroup(entries)).toBe('1')
  })

  it('skips non-numeric group ids when finding next number', () => {
    const entries = makeEntries(['1', 'custom-group', null])
    expect(nextSupersetGroup(entries)).toBe('2')
  })
})

// ---------------------------------------------------------------------------
// reorderEntries
// ---------------------------------------------------------------------------

describe('reorderEntries', () => {
  it('swaps with previous neighbor (direction -1)', () => {
    expect(reorderEntries(['a', 'b', 'c', 'd'], 2, -1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('swaps with next neighbor (direction +1)', () => {
    expect(reorderEntries(['a', 'b', 'c', 'd'], 1, 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('no-op when moving up from the first index', () => {
    const input = ['a', 'b', 'c']
    expect(reorderEntries(input, 0, -1)).toEqual(input)
  })

  it('no-op when moving down from the last index', () => {
    const input = ['a', 'b', 'c']
    expect(reorderEntries(input, 2, 1)).toEqual(input)
  })

  it('returns a new array, never mutates input', () => {
    const input = ['a', 'b', 'c']
    const out = reorderEntries(input, 0, 1)
    expect(out).not.toBe(input)
    expect(input).toEqual(['a', 'b', 'c'])
  })

  it('preserves entry object identity for non-moved items', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    const c = { id: 'c' }
    const out = reorderEntries([a, b, c], 0, 1)
    expect(out[2]).toBe(c)
  })

  it('handles WorkoutEntry shape end-to-end (the real autosave payload)', () => {
    const entries: WorkoutEntry[] = [
      { exercise_id: 'rdl', exercise_name: 'RDL', sets: [{ weight: 60, reps: 8 }] },
      { exercise_id: 'sq', exercise_name: 'Squat', sets: [{ weight: 100, reps: 5 }] },
      { exercise_id: 'bp', exercise_name: 'Bench', sets: [{ weight: 80, reps: 6 }] },
    ]
    const out = reorderEntries(entries, 0, 1)
    // The PUT body would now send Squat, RDL, Bench in that order
    expect(out.map((e) => e.exercise_name)).toEqual(['Squat', 'RDL', 'Bench'])
    // Sets are preserved verbatim
    expect(out[1].sets[0]).toEqual({ weight: 60, reps: 8 })
  })

  it('bounds-check: from index out of range returns original', () => {
    const input = ['a', 'b']
    expect(reorderEntries(input, 5, 1)).toEqual(input)
    expect(reorderEntries(input, -1, 1)).toEqual(input)
  })
})
