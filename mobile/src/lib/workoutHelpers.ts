// mirror of frontend/src/lib/workoutHelpers.ts

import type { SetEntry, WorkoutEntry } from '@fitness/shared-types'
import { toLocalISODate } from './dates'

function dateDiffDays(from: string, to: string): number {
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  return Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24))
}

export function formatLastTime(
  sets: SetEntry[],
  date: string,
  today: string = toLocalISODate(),
  unit: 'kg' | 'lb' = 'kg',
): string {
  const working = sets.filter((s) => !s.is_warmup)
  if (working.length === 0) return ''

  const kg = working[0].weight ?? 0
  const display = unit === 'lb' ? kg / 0.45359237 : kg
  const rounded = Math.round(display * 10) / 10
  const weightStr = rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded)
  const reps = working.map((s) => s.reps).join('/')

  const daysDiff = dateDiffDays(date, today)
  const ago = daysDiff === 0 ? 'today' : `${daysDiff}d ago`

  return `${weightStr}${unit} ${reps}, ${ago}`
}

export function nextSupersetGroup(entries: WorkoutEntry[]): string {
  const used = new Set<number>()
  for (const e of entries) {
    if (e.superset_group) {
      const n = Number(e.superset_group)
      if (Number.isInteger(n) && n > 0) used.add(n)
    }
  }
  let i = 1
  while (used.has(i)) i++
  return String(i)
}

export function reorderEntries<T>(entries: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction
  if (from < 0 || from >= entries.length) return entries
  if (to < 0 || to >= entries.length) return entries
  const next = entries.slice()
  const tmp = next[from]
  next[from] = next[to]
  next[to] = tmp
  return next
}
