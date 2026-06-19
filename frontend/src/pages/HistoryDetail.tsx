import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { workoutsApi } from '../services/api'
import type { Workout } from '@fitness/shared-types'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatVolume(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k kg'
  return v + ' kg'
}

export default function HistoryDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { data: workout, status } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => workoutsApi.get(id!),
    enabled: !!id,
  })

  const handleDelete = async () => {
    if (!id) return
    setDeleting(true)
    try {
      await workoutsApi.remove(id)

      // Surgical cache update: remove from infinite list, decrement total
      queryClient.setQueryData(
        ['workouts'],
        (old: { pages: { items: Workout[]; total: number }[]; pageParams: number[] } | undefined) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              items: p.items.filter((w) => w.id !== id),
              total: Math.max(0, p.total - 1),
            })),
          }
        },
      )

      // The history calendar + home card read from other keys with a stale
      // window — invalidate every workout list view so the deleted workout
      // disappears immediately.
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          typeof q.queryKey[0] === 'string' &&
          (q.queryKey[0] === 'workouts' ||
            q.queryKey[0] === 'workouts-list' ||
            q.queryKey[0] === 'workouts-month'),
      })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })

      toast.success('Workout deleted')
      navigate('/history', { replace: true })
    } catch {
      toast.error('Failed to delete workout')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (status === 'pending') {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (status === 'error' || !workout) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-gray-400 text-sm">Workout not found.</p>
      </div>
    )
  }

  // Group entries by superset_group
  const groups: { supersetGroup: string | null; entries: typeof workout.entries }[] = []
  const seen = new Set<string>()
  for (const entry of workout.entries) {
    const sg = entry.superset_group ?? null
    if (sg && seen.has(sg)) continue
    if (sg) seen.add(sg)
    const groupEntries = sg
      ? workout.entries.filter((e) => e.superset_group === sg)
      : [entry]
    groups.push({ supersetGroup: sg, entries: groupEntries })
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* back button */}
      <button
        onClick={() => navigate('/history')}
        className="flex items-center gap-1 text-sm text-primary-500 font-medium w-fit"
      >
        &lt; History
      </button>

      {/* header card */}
      <div className="card p-4">
        <div className="text-base font-semibold text-gray-900">{formatDate(workout.date)}</div>
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
          <span>{workout.entries.length} exercise{workout.entries.length === 1 ? '' : 's'}</span>
          <span>{formatVolume(workout.total_volume)} total volume</span>
        </div>
        {workout.notes && (
          <p className="text-sm text-gray-600 mt-2 border-t border-gray-100 pt-2">{workout.notes}</p>
        )}
      </div>

      {/* entries */}
      {groups.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No exercises recorded.</p>
      )}

      {groups.map(({ supersetGroup, entries }, gi) => {
        if (supersetGroup) {
          return (
            <div
              key={supersetGroup}
              className="card border-l-4 border-l-primary-400 overflow-hidden"
            >
              <div className="px-4 pt-3 pb-1">
                <span className="text-xs font-semibold text-primary-500 bg-primary-50 px-2 py-0.5 rounded">
                  SUPERSET
                </span>
              </div>
              {entries.map((entry) => (
                <EntryCard key={entry.exercise_id + supersetGroup} entry={entry} />
              ))}
            </div>
          )
        }
        return (
          <div key={gi} className="card overflow-hidden">
            <EntryCard entry={entries[0]} />
          </div>
        )
      })}

      {/* delete */}
      <div className="mt-2">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
          >
            Delete Workout
          </button>
        ) : (
          <div className="card p-4 flex flex-col gap-3">
            <p className="text-sm text-gray-700 font-medium text-center">Delete this workout? This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EntryCard({ entry }: { entry: { exercise_name: string; sets: { weight: number; reps: number; rpe?: number | null; is_warmup?: boolean }[] } }) {
  const workingSets = entry.sets.filter((s) => !s.is_warmup)
  const warmupSets = entry.sets.filter((s) => s.is_warmup)
  return (
    <div className="px-4 py-3 border-b border-gray-50 last:border-0">
      <div className="text-sm font-semibold text-gray-900 mb-2">{entry.exercise_name}</div>
      <div className="flex flex-col gap-1">
        {warmupSets.map((s, i) => (
          <div key={i} className="flex items-center gap-3 text-xs text-gray-400">
            <span className="w-16">Warmup {i + 1}</span>
            <span>{s.weight} kg x {s.reps}</span>
            {s.rpe != null && <span className="text-gray-300">RPE {s.rpe}</span>}
          </div>
        ))}
        {workingSets.map((s, i) => (
          <div key={i} className="flex items-center gap-3 text-xs text-gray-700">
            <span className="w-16 font-medium">Set {i + 1}</span>
            <span className="font-medium">{s.weight} kg x {s.reps}</span>
            {s.rpe != null && <span className="text-gray-400">RPE {s.rpe}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
