import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Equipment, Exercise, ExerciseCreate, ExerciseHistoryItem, Muscle, MovementPattern, Tracking } from '@fitness/shared-types'
import { exercisesApi } from '../services/api'

const MUSCLE_OPTIONS: Muscle[] = [
  'chest', 'back', 'quads', 'hamstrings', 'glutes',
  'shoulders', 'biceps', 'triceps', 'core', 'calves', 'forearms',
]

const MOVEMENT_PATTERN_OPTIONS: MovementPattern[] = ['push', 'pull', 'squat', 'hinge', 'carry', 'core']
const EQUIPMENT_OPTIONS: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'trx', 'other']

export const MUSCLE_COLORS: Record<string, string> = {
  chest: '#ef4444',
  back: '#3b82f6',
  quads: '#f97316',
  hamstrings: '#f59e0b',
  glutes: '#ec4899',
  shoulders: '#8b5cf6',
  biceps: '#06b6d4',
  triceps: '#14b8a6',
  core: '#84cc16',
  calves: '#6366f1',
  forearms: '#6b7280',
}

function CreateExerciseForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string
  onCancel: () => void
  onCreated: (exercise: Exercise) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(initialName)
  const [primaryMuscles, setPrimaryMuscles] = useState<Muscle[]>([])
  const [secondaryMuscles, setSecondaryMuscles] = useState<Muscle[]>([])
  const [pattern, setPattern] = useState<MovementPattern | ''>('')
  const [equipment, setEquipment] = useState<Equipment | ''>('')
  const [tracking, setTracking] = useState<Tracking>('reps')
  const [saving, setSaving] = useState(false)

  const togglePrimary = (m: Muscle) => {
    setPrimaryMuscles((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    )
  }

  const toggleSecondary = (m: Muscle) => {
    setSecondaryMuscles((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    )
  }

  const canSave = name.trim().length > 0 && primaryMuscles.length > 0 && pattern !== '' && equipment !== ''

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const body: ExerciseCreate = {
        name: name.trim(),
        primary_muscles: primaryMuscles,
        secondary_muscles: secondaryMuscles,
        movement_pattern: pattern as MovementPattern,
        equipment: equipment as Equipment,
        tracking,
      }
      const created = await exercisesApi.create(body)
      void qc.invalidateQueries({ queryKey: ['exercises'] })
      toast.success('Exercise created')
      onCreated(created)
    } catch {
      toast.error('Could not create exercise')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Name
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Romanian Deadlift"
          className="w-full border border-gray-200 rounded-xl px-3 h-10 text-sm focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Primary muscles <span className="text-red-400">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {MUSCLE_OPTIONS.map((m) => {
            const active = primaryMuscles.includes(m)
            const color = MUSCLE_COLORS[m] ?? '#9ca3af'
            return (
              <button
                key={m}
                type="button"
                onClick={() => togglePrimary(m)}
                className={`px-3 py-1 rounded-full text-xs font-medium border capitalize transition-colors ${
                  active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'
                }`}
                style={active ? { backgroundColor: color, borderColor: color } : {}}
              >
                {m}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Secondary muscles <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {MUSCLE_OPTIONS.map((m) => {
            const active = secondaryMuscles.includes(m)
            const color = MUSCLE_COLORS[m] ?? '#9ca3af'
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleSecondary(m)}
                className={`px-3 py-1 rounded-full text-xs font-medium border capitalize transition-colors ${
                  active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'
                }`}
                style={active ? { backgroundColor: color, borderColor: color, opacity: 0.75 } : {}}
              >
                {m}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Movement pattern <span className="text-red-400">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {MOVEMENT_PATTERN_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPattern(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium border capitalize ${
                pattern === p
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Equipment <span className="text-red-400">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEquipment(e)}
              className={`px-3 py-1 rounded-full text-xs font-medium border capitalize ${
                equipment === e
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {e === 'trx' ? 'TRX' : e}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Tracking
        </label>
        <div className="flex gap-2">
          {(['reps', 'time'] as Tracking[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTracking(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium border capitalize ${
                tracking === t
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {t === 'reps' ? 'Reps' : 'Time (hold)'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-gray-200 py-2.5 rounded-xl text-sm text-gray-600"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave || saving}
          className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold"
        >
          {saving ? 'Saving...' : 'Save exercise'}
        </button>
      </div>
    </div>
  )
}

export default function AddExerciseSheet({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (exercise: Exercise, history: ExerciseHistoryItem[]) => void
}) {
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | ''>('')
  const [showCreate, setShowCreate] = useState(false)

  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['exercises', q, muscle],
    queryFn: () =>
      exercisesApi.list({
        ...(q ? { q } : {}),
        ...(muscle ? { muscle } : {}),
      }),
    staleTime: 60_000,
  })

  const handlePick = async (ex: Exercise) => {
    try {
      const hist = await exercisesApi.history(ex.id, 1)
      onAdd(ex, hist)
    } catch {
      onAdd(ex, [])
    }
  }

  const handleCreated = async (ex: Exercise) => {
    try {
      const hist = await exercisesApi.history(ex.id, 1)
      onAdd(ex, hist)
    } catch {
      onAdd(ex, [])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="bg-white rounded-t-2xl max-h-[80vh] flex flex-col">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-3">
            {showCreate ? (
              <h3 className="flex-1 font-semibold text-gray-900 text-sm">New custom exercise</h3>
            ) : (
              <input
                autoFocus
                type="text"
                placeholder="Search exercises..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 h-10 text-sm focus:outline-none focus:border-blue-400"
              />
            )}
            <button onClick={onClose} className="text-gray-500 text-sm px-2">
              Cancel
            </button>
          </div>
          {!showCreate && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setMuscle('')}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
                  muscle === '' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                All
              </button>
              {MUSCLE_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMuscle(muscle === m ? '' : m)}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border capitalize ${
                    muscle === m ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {showCreate ? (
          <CreateExerciseForm
            initialName={q}
            onCancel={() => setShowCreate(false)}
            onCreated={(ex) => void handleCreated(ex)}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {isLoading ? (
              <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
            ) : (
              <>
                {exercises.length === 0 && q.trim().length > 0 && (
                  <p className="text-sm text-gray-400 text-center pt-8 pb-2">
                    No exercises match &quot;{q}&quot;.
                  </p>
                )}
                {exercises.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => void handlePick(ex)}
                    className="w-full text-left py-3 border-b border-gray-50 last:border-0"
                  >
                    <p className="text-sm font-medium text-gray-900">{ex.name}</p>
                    <div className="flex gap-1 mt-1">
                      {ex.primary_muscles.map((m) => (
                        <span
                          key={m}
                          className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs capitalize"
                        >
                          {m}
                        </span>
                      ))}
                      <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 text-xs">
                        {ex.equipment}
                      </span>
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full mt-3 border border-dashed border-blue-200 rounded-xl py-3 text-sm text-blue-500 font-medium hover:bg-blue-50"
                >
                  + Create custom exercise
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
