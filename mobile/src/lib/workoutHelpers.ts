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
): string {
  const working = sets.filter((s) => !s.is_warmup)
  if (working.length === 0) return ''

  const weight = working[0].weight
  const reps = working.map((s) => s.reps).join('/')

  const daysDiff = dateDiffDays(date, today)
  const ago = daysDiff === 0 ? 'today' : `${daysDiff}d ago`

  return `${weight}kg ${reps}, ${ago}`
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
