import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Exercise, ExerciseHistoryItem, FinishResponse, SetEntry, Tracking, Workout, WorkoutEntry, WorkoutTemplate } from '@fitness/shared-types'
import { exercisesApi, templatesApi, workoutsApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'
import { formatDuration, nextSupersetGroup } from '../lib/workoutHelpers'
import { buildEntryFromHistory } from '../lib/addExercise'
import type { EntryWithHistory } from '../lib/addExercise'
import AddExerciseSheet from '../components/AddExerciseSheet'
import { startFromPlan } from '../lib/startFromPlan'
import SessionIntentModal, { type SessionIntent } from '../components/SessionIntentModal'
import type { NextExerciseSuggestion } from '../services/api'

// ---------------------------------------------------------------------------
// Autosave hook
// ---------------------------------------------------------------------------

function useAutosave(
  workoutId: string | null,
  entries: WorkoutEntry[],
  enabled: boolean,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const save = useCallback(
    async (id: string, e: WorkoutEntry[]) => {
      setSaveState('saving')
      try {
        await workoutsApi.update(id, { entries: e })
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2000)
      } catch {
        setSaveState('error')
        toast.error('Autosave failed, retrying')
        try {
          await workoutsApi.update(id, { entries: e })
          setSaveState('saved')
          setTimeout(() => setSaveState('idle'), 2000)
        } catch {
          setSaveState('error')
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !workoutId) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void save(workoutId, entries)
    }, 800)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [workoutId, entries, enabled, save])

  return saveState
}

// ---------------------------------------------------------------------------
// Set row
// ---------------------------------------------------------------------------

/**
 * Parse a duration string of the form "m:ss", "mm:ss", or plain seconds.
 * Returns total seconds, or null if unparseable.
 */
function parseDurationInput(val: string): number | null {
  const trimmed = val.trim()
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length !== 2) return null
    const m = parseInt(parts[0], 10)
    const s = parseInt(parts[1], 10)
    if (isNaN(m) || isNaN(s)) return null
    return Math.max(0, m * 60 + s)
  }
  const n = parseFloat(trimmed)
  if (isNaN(n)) return null
  return Math.max(0, Math.round(n))
}

function SetRow({
  set,
  index,
  tracking,
  onUpdate,
  onRemove,
}: {
  set: SetEntry
  index: number
  tracking: Tracking
  onUpdate: (s: SetEntry) => void
  onRemove: () => void
}) {
  const isWarmup = !!set.is_warmup
  const isTime = tracking === 'time'

  // Local text state for duration input to allow free-form typing
  const [durationText, setDurationText] = useState<string | null>(null)

  const stepWeight = (delta: number) => {
    const val = Math.max(0, (set.weight ?? 0) + delta)
    onUpdate({ ...set, weight: val })
  }

  const stepDuration = (delta: number) => {
    const current = set.duration_s ?? 0
    const next = Math.max(0, current + delta)
    onUpdate({ ...set, duration_s: next, reps: 0 })
    setDurationText(null)
  }

  const stepReps = (delta: number) => {
    const val = Math.max(0, (set.reps ?? 0) + delta)
    onUpdate({ ...set, reps: val })
  }

  return (
    <div className={`flex items-center gap-2 py-1.5 ${isWarmup ? 'opacity-50' : ''}`}>
      {/* Warmup toggle */}
      <button
        onClick={() => onUpdate({ ...set, is_warmup: !set.is_warmup })}
        className={`w-6 h-6 rounded text-xs font-semibold flex-shrink-0 border ${
          isWarmup
            ? 'bg-yellow-100 border-yellow-300 text-yellow-700'
            : 'bg-gray-100 border-gray-200 text-gray-500'
        }`}
        title={isWarmup ? 'Warmup set' : 'Mark as warmup'}
        aria-label="toggle warmup"
      >
        W
      </button>

      {/* Weight */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => stepWeight(-2.5)}
          className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm"
          aria-label="decrease weight"
        >
          -
        </button>
        <input
          type="number"
          value={set.weight}
          onChange={(e) => onUpdate({ ...set, weight: parseFloat(e.target.value) || 0 })}
          className="w-14 text-center border border-gray-200 rounded-lg h-7 text-sm focus:outline-none focus:border-blue-400"
          aria-label={`set ${index + 1} weight`}
        />
        <button
          onClick={() => stepWeight(2.5)}
          className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm"
          aria-label="increase weight"
        >
          +
        </button>
        <span className="text-xs text-gray-400">{isTime ? 'added kg' : 'kg'}</span>
      </div>

      {/* Duration (time exercises) or Reps (reps exercises) */}
      {isTime ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => stepDuration(-15)}
            className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm"
            aria-label="decrease duration"
          >
            -
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={durationText ?? formatDuration(set.duration_s ?? 0)}
            onChange={(e) => setDurationText(e.target.value)}
            onBlur={(e) => {
              const parsed = parseDurationInput(e.target.value)
              if (parsed !== null) {
                onUpdate({ ...set, duration_s: parsed, reps: 0 })
              }
              setDurationText(null)
            }}
            className="w-14 text-center border border-gray-200 rounded-lg h-7 text-sm focus:outline-none focus:border-blue-400"
            aria-label={`set ${index + 1} duration`}
            placeholder="0:00"
          />
          <button
            onClick={() => stepDuration(15)}
            className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm"
            aria-label="increase duration"
          >
            +
          </button>
          <span className="text-xs text-gray-400">m:ss</span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => stepReps(-1)}
            className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm"
            aria-label="decrease reps"
          >
            -
          </button>
          <input
            type="number"
            value={set.reps}
            onChange={(e) => onUpdate({ ...set, reps: parseInt(e.target.value, 10) || 0 })}
            className="w-12 text-center border border-gray-200 rounded-lg h-7 text-sm focus:outline-none focus:border-blue-400"
            aria-label={`set ${index + 1} reps`}
          />
          <button
            onClick={() => stepReps(1)}
            className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm"
            aria-label="increase reps"
          >
            +
          </button>
          <span className="text-xs text-gray-400">reps</span>
        </div>
      )}

      {/* RPE */}
      <input
        type="number"
        min={0}
        max={10}
        placeholder="RPE"
        value={set.rpe ?? ''}
        onChange={(e) => onUpdate({ ...set, rpe: e.target.value ? parseFloat(e.target.value) : null })}
        className="w-12 text-center border border-gray-200 rounded-lg h-7 text-xs text-gray-500 focus:outline-none focus:border-blue-400"
        aria-label={`set ${index + 1} RPE`}
      />

      {/* Remove */}
      <button
        onClick={onRemove}
        className="ml-auto text-gray-300 hover:text-red-400 text-lg leading-none"
        aria-label="remove set"
      >
        x
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entry card
// ---------------------------------------------------------------------------

function EntryCard({
  entry,
  onUpdate,
  onRemove,
  onAlternatives,
  isInSuperset,
  inSelectMode,
  isSelected,
  onToggleSelect,
}: {
  entry: EntryWithHistory
  onUpdate: (e: WorkoutEntry) => void
  onRemove: () => void
  onAlternatives: () => void
  isInSuperset: boolean
  inSelectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}) {
  const navigate = useNavigate()
  const updateSet = (i: number, s: SetEntry) => {
    const sets = entry.sets.map((x, idx) => (idx === i ? s : x))
    onUpdate({ ...entry, sets })
  }

  const removeSet = (i: number) => {
    const sets = entry.sets.filter((_, idx) => idx !== i)
    onUpdate({ ...entry, sets })
  }

  const isTimeEntry = (entry.tracking ?? 'reps') === 'time'

  const addSet = () => {
    const last = entry.sets[entry.sets.length - 1]
      ?? (isTimeEntry ? { weight: 0, reps: 0, duration_s: 0 } : { weight: 0, reps: 0 })
    onUpdate({ ...entry, sets: [...entry.sets, { ...last, is_warmup: false }] })
  }

  return (
    <div
      className={`card p-4 mb-2 ${isInSuperset ? 'border-l-4 border-l-blue-400' : ''} ${
        isSelected ? 'ring-2 ring-blue-400' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {inSelectMode && (
            <button
              onClick={onToggleSelect}
              className={`w-5 h-5 rounded border flex-shrink-0 ${
                isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
              }`}
              aria-label="select entry"
            />
          )}
          <div className="min-w-0">
            {entry.exercise_id ? (
              <button
                onClick={() => navigate(`/library/${entry.exercise_id}`)}
                className="flex items-center gap-1 text-left group"
                title="View exercise"
              >
                <span className="font-semibold text-sm text-blue-600 truncate group-hover:underline">
                  {entry.exercise_name}
                </span>
                <span className="text-blue-400 flex-shrink-0">›</span>
              </button>
            ) : (
              <p className="font-semibold text-sm text-gray-900 truncate">{entry.exercise_name}</p>
            )}
            {entry.lastTime && (
              <p className="text-xs text-gray-400 mt-0.5">{entry.lastTime}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <button
            onClick={onAlternatives}
            className="text-xs text-blue-500 font-medium px-2 py-1 rounded-lg hover:bg-blue-50"
          >
            Swap
          </button>
          <button
            onClick={onRemove}
            className="text-xs text-gray-400 hover:text-red-400 px-1 py-1"
            aria-label="remove exercise"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-0.5">
        {entry.sets.map((s, i) => (
          <SetRow
            key={i}
            set={s}
            index={i}
            tracking={entry.tracking ?? 'reps'}
            onUpdate={(updated) => updateSet(i, updated)}
            onRemove={() => removeSet(i)}
          />
        ))}
      </div>

      <button
        onClick={addSet}
        className="mt-2 text-xs text-blue-500 font-medium hover:text-blue-700"
      >
        + Add set
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alternatives sheet
// ---------------------------------------------------------------------------

function AlternativesSheet({
  exerciseId,
  onClose,
  onSwap,
}: {
  exerciseId: string
  onClose: () => void
  onSwap: (ex: Exercise) => void
}) {
  const { data: alts = [], isLoading } = useQuery({
    queryKey: ['alternatives', exerciseId],
    queryFn: () => exercisesApi.alternatives(exerciseId),
    staleTime: 60_000,
  })

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="bg-white rounded-t-2xl max-h-[60vh] flex flex-col">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Swap exercise</h3>
          <button onClick={onClose} className="text-gray-500 text-sm">
            Cancel
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
          ) : alts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No alternatives found.</p>
          ) : (
            alts.map((ex) => (
              <button
                key={ex.id}
                onClick={() => onSwap(ex)}
                className="w-full text-left py-3 border-b border-gray-50 last:border-0"
              >
                <p className="text-sm font-medium text-gray-900">{ex.name}</p>
                <div className="flex gap-1 mt-1">
                  {ex.primary_muscles.map((m) => (
                    <span key={m} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs capitalize">
                      {m}
                    </span>
                  ))}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Finish modal
// ---------------------------------------------------------------------------

function FinishModal({
  data,
  startedAt,
  onClose,
}: {
  data: FinishResponse
  startedAt: string | null
  onClose: () => void
}) {
  let duration = ''
  if (startedAt && data.ended_at) {
    const mins = Math.round(
      (new Date(data.ended_at).getTime() - new Date(startedAt).getTime()) / 60_000,
    )
    duration = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="bg-black/40 absolute inset-0" onClick={onClose} />
      <div className="card p-6 w-full max-w-sm relative z-10">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Workout done!</h2>
        {duration && <p className="text-sm text-gray-500 mb-3">Duration: {duration}</p>}
        <p className="text-sm text-gray-700 mb-4">
          Total volume: <span className="font-semibold">{Math.round(data.total_volume).toLocaleString()} kg</span>
        </p>
        {data.prs.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Personal Records</p>
            <div className="space-y-1">
              {data.prs.map((pr) => (
                <p key={pr.exercise_id} className="text-sm text-gray-800">
                  {pr.duration_s != null
                    ? `New PR: ${pr.exercise_name} ${formatDuration(pr.duration_s)}${pr.previous_best_duration_s != null ? ` (previous ${formatDuration(pr.previous_best_duration_s)})` : ''}`
                    : `New PR: ${pr.exercise_name} ${pr.weight}kg (previous ${pr.previous_best}kg)`}
                </p>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={onClose}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm"
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan chooser sheet
// ---------------------------------------------------------------------------

function PlanChooserSheet({
  onBlank,
  onClose,
  onPlanStart,
}: {
  onBlank: () => void
  onClose: () => void
  onPlanStart: (template: WorkoutTemplate) => void
}) {
  const [showPlans, setShowPlans] = useState(false)
  const { data: templates = [], isLoading } = useQuery<WorkoutTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    enabled: showPlans,
  })

  if (!showPlans) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col">
        <div className="flex-1 bg-black/40" onClick={onClose} />
        <div className="bg-white rounded-t-2xl p-5 flex flex-col gap-3">
          <span className="text-sm font-semibold text-gray-900">Start workout</span>
          <button
            onClick={onBlank}
            className="w-full py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600"
          >
            Start blank workout
          </button>
          <button
            onClick={() => setShowPlans(true)}
            className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50"
          >
            Start from plan
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl text-sm text-gray-400 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="bg-white rounded-t-2xl max-h-[60vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Choose a plan</span>
          <button onClick={() => setShowPlans(false)} className="text-xs text-gray-500">Back</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No plans yet. Create one from Home.</p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                onClick={() => onPlanStart(t)}
                className="w-full text-left py-3 border-b border-gray-50 last:border-0"
              >
                <p className="text-sm font-medium text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t.entries.length} exercise{t.entries.length !== 1 ? 's' : ''}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Workout page
// ---------------------------------------------------------------------------

export default function Workout() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // Active workout from server
  const { data: activeWorkout, isLoading } = useQuery<Workout | null>({
    queryKey: ['workout', 'active'],
    queryFn: () => workoutsApi.active(),
    staleTime: 0,
  })

  const [workout, setWorkout] = useState<Workout | null>(null)
  const [entries, setEntries] = useState<EntryWithHistory[]>([])
  const [starting, setStarting] = useState(false)
  const [showChooser, setShowChooser] = useState(false)
  const [showIntent, setShowIntent] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<WorkoutTemplate | null>(null)
  const [suggestion, setSuggestion] = useState<NextExerciseSuggestion | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestAdding, setSuggestAdding] = useState(false)

  // Sync server -> local state once on load (not on every re-render)
  useEffect(() => {
    if (activeWorkout !== undefined && workout === null) {
      setWorkout(activeWorkout)
      if (activeWorkout) {
        setEntries(activeWorkout.entries.map((e) => ({ ...e, lastTime: undefined })))
      }
    }
  }, [activeWorkout, workout])

  // Sheet states
  const [showAdd, setShowAdd] = useState(false)
  const [altFor, setAltFor] = useState<number | null>(null) // index in entries

  // Superset select mode
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Finish
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishData, setFinishData] = useState<FinishResponse | null>(null)

  // Autosave — only enabled once we have a workout id
  const saveState = useAutosave(workout?.id ?? null, entries, workout !== null)

  // Save indicator label
  const saveLabel =
    saveState === 'saving' ? 'Saving...'
    : saveState === 'saved' ? 'Saved'
    : saveState === 'error' ? 'Save failed'
    : ''

  const handleStart = () => {
    setShowChooser(false)
    setPendingTemplate(null)
    setShowIntent(true)
  }

  const handleStartFromPlan = (template: WorkoutTemplate) => {
    setShowChooser(false)
    setPendingTemplate(template)
    setShowIntent(true)
  }

  const handleIntentStart = async (intent: SessionIntent) => {
    setStarting(true)
    const hasIntent =
      intent.goal || intent.energy != null || intent.mental != null || intent.physical != null
    try {
      if (pendingTemplate) {
        const workoutId = await startFromPlan(pendingTemplate, hasIntent ? intent : undefined)
        const w = await workoutsApi.active()
        if (w && w.id === workoutId) {
          setWorkout(w)
          setEntries(w.entries.map((e) => ({ ...e, lastTime: undefined })))
        } else {
          void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
        }
      } else {
        const w = await workoutsApi.create({
          date: toLocalISODate(),
          intent: hasIntent ? intent : undefined,
        })
        setWorkout(w)
        setEntries([])
      }
      setShowIntent(false)
      setPendingTemplate(null)
    } catch {
      toast.error('Could not start workout')
    } finally {
      setStarting(false)
    }
  }

  const requestSuggestion = async () => {
    if (!workout) return
    setSuggestLoading(true)
    try {
      const s = await workoutsApi.suggestNext(workout.id)
      setSuggestion(s)
    } catch {
      toast.error('Could not suggest')
    } finally {
      setSuggestLoading(false)
    }
  }

  const approveSuggestion = async () => {
    if (!workout || !suggestion) return
    setSuggestAdding(true)
    try {
      const hist = await exercisesApi.history(suggestion.exercise_id, 1).catch(() => [])
      const built = buildEntryFromHistory(
        { id: suggestion.exercise_id, name: suggestion.exercise_name } as Exercise,
        hist,
      )
      if (!hist.length) {
        built.sets = Array.from({ length: suggestion.sets }).map(() => ({
          weight: 0,
          reps: suggestion.reps,
          is_warmup: false,
        }))
      }
      setEntries((prev) => [...prev, built])
      setSuggestion(null)
    } finally {
      setSuggestAdding(false)
    }
  }

  const handleAddExercise = async (exercise: Exercise, hist: ExerciseHistoryItem[]) => {
    setShowAdd(false)
    if (!workout) return
    const newEntry = buildEntryFromHistory(exercise, hist)
    setEntries((prev) => [...prev, newEntry])
  }

  const handleUpdateEntry = (i: number, updated: WorkoutEntry) => {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...updated } : e)))
  }

  const handleRemoveEntry = (i: number) => {
    setEntries((prev) => prev.filter((_, idx) => idx !== i))
  }

  const handleSwapExercise = (i: number, ex: Exercise) => {
    setEntries((prev) =>
      prev.map((e, idx) =>
        idx === i ? { ...e, exercise_id: ex.id, exercise_name: ex.name } : e,
      ),
    )
    setAltFor(null)
  }

  // Superset group/ungroup
  const handleGroup = () => {
    if (selected.size < 2) {
      toast('Select at least 2 exercises to group')
      return
    }
    const group = nextSupersetGroup(entries)
    setEntries((prev) =>
      prev.map((e, i) => (selected.has(i) ? { ...e, superset_group: group } : e)),
    )
    setSelected(new Set())
    setSelectMode(false)
  }

  const handleUngroup = () => {
    setEntries((prev) =>
      prev.map((e, i) => (selected.has(i) ? { ...e, superset_group: null } : e)),
    )
    setSelected(new Set())
    setSelectMode(false)
  }

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // Finish
  const handleFinish = async () => {
    if (!workout) return
    setConfirmFinish(false)
    setFinishing(true)
    try {
      const result = await workoutsApi.finish(workout.id)
      setFinishData(result)
      // Invalidate dashboard summary; surgical cache update for the workouts infinite list
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.setQueryData(
        ['workouts'],
        (old: { pages: { items: Workout[]; total: number }[]; pageParams: number[] } | undefined) => {
          if (!old || old.pages.length === 0) return old // no cache yet: History fetches fresh
          const { prs: _prs, ...finished } = result
          const exists = old.pages.some((p) => p.items.some((w) => w.id === finished.id))
          return {
            ...old,
            pages: old.pages.map((p, i) => {
              if (exists) {
                return { ...p, items: p.items.map((w) => (w.id === finished.id ? finished : w)) }
              }
              return {
                ...p,
                items: i === 0 ? [finished, ...p.items] : p.items,
                total: p.total + 1,
              }
            }),
          }
        },
      )
      void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      // Name the session asynchronously — never blocks the finish. Fired ONCE
      // here (not on render/refresh); the endpoint is idempotent + rate-limited
      // server-side, so it can't burn tokens. Refresh lists once it lands.
      void workoutsApi
        .generateTitle(result.id)
        .then((res) => {
          if (res?.title) {
            void qc.invalidateQueries({ queryKey: ['workouts'] })
            void qc.invalidateQueries({ queryKey: ['workouts-month'] })
          }
        })
        .catch(() => {})
    } catch {
      toast.error('Could not finish workout')
    } finally {
      setFinishing(false)
    }
  }

  const handleFinishClose = () => {
    setFinishData(null)
    navigate('/')
  }

  // Group superset entries for rendering
  const grouped = groupEntries(entries)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (!workout) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-gray-500 text-sm text-center">No active session.</p>
        <button
          onClick={() => setShowChooser(true)}
          disabled={starting}
          className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl text-sm"
        >
          {starting ? 'Starting...' : 'START WORKOUT'}
        </button>
        {showChooser && (
          <PlanChooserSheet
            onBlank={() => handleStart()}
            onClose={() => setShowChooser(false)}
            onPlanStart={(t) => handleStartFromPlan(t)}
          />
        )}
        <SessionIntentModal
          open={showIntent}
          starting={starting}
          onCancel={() => { setShowIntent(false); setPendingTemplate(null) }}
          onStart={(intent) => void handleIntentStart(intent)}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col p-4">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs text-gray-400">{workout.date}</p>
          {saveLabel && (
            <p className={`text-xs mt-0.5 ${saveState === 'error' ? 'text-red-400' : 'text-green-500'}`}>
              {saveLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <button
                onClick={handleGroup}
                className="text-xs font-semibold text-blue-500 px-3 py-1.5 rounded-lg border border-blue-200"
              >
                Group
              </button>
              <button
                onClick={handleUngroup}
                className="text-xs font-semibold text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200"
              >
                Ungroup
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelected(new Set()) }}
                className="text-xs text-gray-400 px-2 py-1.5"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setSelectMode(true)}
                className="text-xs text-gray-500 font-medium px-3 py-1.5 rounded-lg border border-gray-200"
              >
                Superset
              </button>
              <button
                onClick={() => setConfirmFinish(true)}
                disabled={finishing}
                className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 rounded-lg"
              >
                Finish
              </button>
            </>
          )}
        </div>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-12">
            No exercises yet. Tap "Add exercise" to begin.
          </p>
        )}

        {grouped.map((group) => {
          if (group.type === 'single') {
            const { entry, originalIndex } = group
            return (
              <EntryCard
                key={originalIndex}
                entry={entry}
                onUpdate={(u) => handleUpdateEntry(originalIndex, u)}
                onRemove={() => handleRemoveEntry(originalIndex)}
                onAlternatives={() => setAltFor(originalIndex)}
                isInSuperset={false}
                inSelectMode={selectMode}
                isSelected={selected.has(originalIndex)}
                onToggleSelect={() => toggleSelect(originalIndex)}
              />
            )
          }

          // Superset group
          return (
            <div key={group.groupId} className="mb-2">
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-xs font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                  SUPERSET
                </span>
              </div>
              <div className="border-l-4 border-blue-400 pl-2">
                {group.entries.map(({ entry, originalIndex }) => (
                  <EntryCard
                    key={originalIndex}
                    entry={entry}
                    onUpdate={(u) => handleUpdateEntry(originalIndex, u)}
                    onRemove={() => handleRemoveEntry(originalIndex)}
                    onAlternatives={() => setAltFor(originalIndex)}
                    isInSuperset={true}
                    inSelectMode={selectMode}
                    isSelected={selected.has(originalIndex)}
                    onToggleSelect={() => toggleSelect(originalIndex)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex-1 border-2 border-dashed border-gray-200 rounded-xl py-4 text-sm text-gray-400 font-medium hover:border-blue-300 hover:text-blue-400"
          >
            + Add exercise
          </button>
          <button
            onClick={() => void requestSuggestion()}
            disabled={suggestLoading}
            className="px-4 py-4 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {suggestLoading ? '...' : '✨ Suggest'}
          </button>
        </div>
      </div>

      {/* Approve / cancel AI suggestion */}
      {suggestion && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">{suggestion.exercise_name}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {suggestion.sets} sets × {suggestion.reps} reps
              {suggestion.primary_muscles?.length
                ? ` · ${suggestion.primary_muscles.join(', ')}`
                : ''}
            </p>
            {suggestion.reason && (
              <p className="text-sm text-gray-700 mt-3 italic">{suggestion.reason}</p>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setSuggestion(null)}
                className="flex-1 px-3 py-2 text-sm font-medium border border-gray-200 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void approveSuggestion()}
                disabled={suggestAdding}
                className="flex-1 px-3 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {suggestAdding ? 'Adding...' : 'Add to workout'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SessionIntentModal
        open={showIntent}
        starting={starting}
        onCancel={() => { setShowIntent(false); setPendingTemplate(null) }}
        onStart={(intent) => void handleIntentStart(intent)}
      />

      {/* Sheets */}
      {showAdd && (
        <AddExerciseSheet
          onClose={() => setShowAdd(false)}
          onAdd={(ex, hist) => void handleAddExercise(ex, hist)}
        />
      )}
      {altFor !== null && (
        <AlternativesSheet
          exerciseId={entries[altFor].exercise_id}
          onClose={() => setAltFor(null)}
          onSwap={(ex) => handleSwapExercise(altFor, ex)}
        />
      )}

      {/* Confirm finish dialog */}
      {confirmFinish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-black/40 absolute inset-0" onClick={() => setConfirmFinish(false)} />
          <div className="card p-6 w-full max-w-xs relative z-10">
            <p className="font-semibold text-gray-900 mb-4">Finish this workout?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmFinish(false)}
                className="flex-1 border border-gray-200 py-2 rounded-xl text-sm text-gray-600"
              >
                Keep going
              </button>
              <button
                onClick={() => void handleFinish()}
                className="flex-1 bg-blue-500 text-white py-2 rounded-xl text-sm font-semibold"
              >
                Finish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish summary modal */}
      {finishData && (
        <FinishModal
          data={finishData}
          startedAt={workout.started_at}
          onClose={handleFinishClose}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GroupedEntry =
  | { type: 'single'; entry: EntryWithHistory; originalIndex: number }
  | { type: 'superset'; groupId: string; entries: { entry: EntryWithHistory; originalIndex: number }[] }

function groupEntries(entries: EntryWithHistory[]): GroupedEntry[] {
  const result: GroupedEntry[] = []
  const seenGroups = new Map<string, number>() // groupId -> result index

  entries.forEach((entry, i) => {
    const g = entry.superset_group
    if (!g) {
      result.push({ type: 'single', entry, originalIndex: i })
    } else {
      const existing = seenGroups.get(g)
      if (existing !== undefined) {
        const group = result[existing] as Extract<GroupedEntry, { type: 'superset' }>
        group.entries.push({ entry, originalIndex: i })
      } else {
        seenGroups.set(g, result.length)
        result.push({ type: 'superset', groupId: g, entries: [{ entry, originalIndex: i }] })
      }
    }
  })

  return result
}
