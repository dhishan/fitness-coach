import type { SetEntry, WorkoutEntry } from '@fitness/shared-types'
import { toLocalISODate } from './dates'

/**
 * Format a duration in seconds as m:ss (e.g. 75 -> "1:15").
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

/**
 * Format the "last time" summary line shown under an exercise name.
 *
 * For reps exercises:
 *   Shows: "{weight}kg {reps/reps/...}, {N}d ago"
 * For time exercises (first working set has duration_s != null):
 *   Shows: "{duration/duration/...}, {N}d ago"
 *   Prefix "+{weight}kg " only when added weight > 0.
 *
 * - Only working sets (is_warmup !== true) are included.
 * - Returns empty string when there are no sets.
 *
 * @param sets   SetEntry array from the last session
 * @param date   ISO date string of that session (e.g. "2026-06-09")
 * @param today  ISO date string for today; defaults to actual today (injectable for tests)
 */
export function formatLastTime(
  sets: SetEntry[],
  date: string,
  today: string = toLocalISODate(),
): string {
  const working = sets.filter((s) => !s.is_warmup)
  if (working.length === 0) return ''

  const daysDiff = dateDiffDays(date, today)
  const ago = daysDiff === 0 ? 'today' : `${daysDiff}d ago`

  // Time-tracked: first working set has duration_s set
  if (working[0].duration_s != null) {
    const durations = working.map((s) => formatDuration(s.duration_s ?? 0)).join('/')
    const weight = working[0].weight
    const prefix = weight > 0 ? `+${weight}kg ` : ''
    return `${prefix}${durations}, ${ago}`
  }

  const weight = working[0].weight
  const reps = working.map((s) => s.reps).join('/')

  return `${weight}kg ${reps}, ${ago}`
}

function dateDiffDays(from: string, to: string): number {
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  return Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24))
}

/**
 * Return the smallest unused positive integer string ("1", "2", ...) for the
 * next superset group id.
 */
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
