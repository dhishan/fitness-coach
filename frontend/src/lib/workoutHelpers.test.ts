import { describe, it, expect } from 'vitest'
import { formatLastTime, nextSupersetGroup } from './workoutHelpers'
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
