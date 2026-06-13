import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Exercise, ExerciseHistoryItem, TemplateEntry, WorkoutEntry } from '@fitness/shared-types'
import { templatesApi } from '../services/api'
import { nextSupersetGroup } from '../lib/workoutHelpers'
import AddExerciseSheet from '../components/AddExerciseSheet'
import { buildEntryFromHistory } from '../lib/addExercise'

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  onUpdate,
  onRemove,
  onToggleSuperset,
}: {
  entry: TemplateEntry
  onUpdate: (e: TemplateEntry) => void
  onRemove: () => void
  onToggleSuperset: () => void
}) {
  const inSuperset = !!entry.superset_group
  const groupLabel = entry.superset_group ? `SS ${entry.superset_group}` : null

  const stepSets = (delta: number) => {
    const next = Math.min(20, Math.max(1, entry.target_sets + delta))
    onUpdate({ ...entry, target_sets: next })
  }

  // Determine superset badge colour by group index
  const groupNum = entry.superset_group ? Number(entry.superset_group) : 0
  const badgeColors = [
    'bg-purple-100 text-purple-700',
    'bg-teal-100 text-teal-700',
    'bg-orange-100 text-orange-700',
    'bg-pink-100 text-pink-700',
  ]
  const badgeColor = badgeColors[(groupNum - 1) % badgeColors.length] ?? badgeColors[0]

  return (
    <div
      className={`card p-3 ${inSuperset ? 'border-l-4 border-l-purple-400' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{entry.exercise_name}</span>
            {groupLabel && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{groupLabel}</span>
            )}
          </div>
        </div>

        {/* Remove */}
        <button
          onClick={onRemove}
          className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 p-1"
          aria-label="Remove exercise"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="mt-2 flex items-center gap-4">
        {/* Sets stepper */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Sets</span>
          <button
            onClick={() => stepSets(-1)}
            className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-base leading-none"
            aria-label="Decrease sets"
          >
            -
          </button>
          <span className="text-sm font-semibold text-gray-800 w-5 text-center">{entry.target_sets}</span>
          <button
            onClick={() => stepSets(1)}
            className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-base leading-none"
            aria-label="Increase sets"
          >
            +
          </button>
        </div>

        {/* Superset toggle */}
        <button
          onClick={onToggleSuperset}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            inSuperset
              ? 'bg-purple-500 text-white border-purple-500'
              : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-500'
          }`}
        >
          {inSuperset ? 'In superset' : 'Superset'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan editor
// ---------------------------------------------------------------------------

export default function PlanEditor() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isNew = !id
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [entries, setEntries] = useState<TemplateEntry[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Load existing template when editing
  const { data: template, isLoading } = useQuery({
    queryKey: ['template', id],
    queryFn: () => templatesApi.get(id!),
    enabled: !isNew,
  })

  useEffect(() => {
    if (template) {
      setName(template.name)
      setEntries(template.entries)
    }
  }, [template])

  // ---------------------------------------------------------------------------
  // Exercise picker callback
  // ---------------------------------------------------------------------------

  const handleAdd = (_exercise: Exercise, history: ExerciseHistoryItem[]) => {
    const built = buildEntryFromHistory(_exercise, history)
    const templateEntry: TemplateEntry = {
      exercise_id: built.exercise_id,
      exercise_name: built.exercise_name,
      target_sets: built.sets.filter((s) => !s.is_warmup).length || 3,
      superset_group: null,
    }
    setEntries((prev) => [...prev, templateEntry])
    setShowPicker(false)
  }

  // ---------------------------------------------------------------------------
  // Entry mutations
  // ---------------------------------------------------------------------------

  const updateEntry = (index: number, updated: TemplateEntry) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? updated : e)))
  }

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index))
  }

  const toggleSuperset = (index: number) => {
    setEntries((prev) => {
      const entry = prev[index]
      if (entry.superset_group) {
        // Remove from superset
        return prev.map((e, i) => (i === index ? { ...e, superset_group: null } : e))
      }
      // Add to a new superset group (or join previous entry's group if it has one)
      const prevEntry = prev[index - 1]
      const group = prevEntry?.superset_group ?? nextSupersetGroup(prev as unknown as WorkoutEntry[])
      return prev.map((e, i) => (i === index ? { ...e, superset_group: group } : e))
    })
  }

  // ---------------------------------------------------------------------------
  // Save / delete
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Plan needs a name')
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        await templatesApi.create({ name: name.trim(), entries })
      } else {
        await templatesApi.update(id!, { name: name.trim(), entries })
      }
      void qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success(isNew ? 'Plan created' : 'Plan saved')
      navigate('/')
    } catch {
      toast.error('Could not save plan')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await templatesApi.remove(id!)
      void qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Plan deleted')
      navigate('/')
    } catch {
      toast.error('Could not delete plan')
    } finally {
      setDeleting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="bg-gray-100 rounded-xl animate-pulse h-10" />
        <div className="bg-gray-100 rounded-xl animate-pulse h-24" />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-4 pb-32">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-500 hover:text-gray-700 p-1"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-gray-900 flex-1">
            {isNew ? 'New plan' : 'Edit plan'}
          </h1>
        </div>

        {/* Name input */}
        <div className="card p-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Plan name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Push Day, Upper Body..."
            maxLength={80}
            className="w-full border border-gray-200 rounded-xl px-3 h-10 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* Exercises */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-900">Exercises</span>
            <span className="text-xs text-gray-400">{entries.length} added</span>
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">
              No exercises yet. Tap &quot;Add exercise&quot; below.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry, i) => (
                <EntryRow
                  key={`${entry.exercise_id}-${i}`}
                  entry={entry}
                  onUpdate={(updated) => updateEntry(i, updated)}
                  onRemove={() => removeEntry(i)}
                  onToggleSuperset={() => toggleSuperset(i)}
                />
              ))}
            </div>
          )}

          <button
            onClick={() => setShowPicker(true)}
            className="mt-3 w-full border border-dashed border-blue-200 rounded-xl py-3 text-sm text-blue-500 font-medium hover:bg-blue-50"
          >
            + Add exercise
          </button>
        </div>

        {/* Delete (edit mode) */}
        {!isNew && (
          <div className="card p-4">
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                confirmDelete
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-white border border-red-200 text-red-500 hover:bg-red-50'
              }`}
            >
              {deleting ? 'Deleting...' : confirmDelete ? 'Tap again to confirm delete' : 'Delete plan'}
            </button>
          </div>
        )}
      </div>

      {/* Sticky save button */}
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 pb-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving || !name.trim()}
          className="w-full py-3.5 rounded-xl bg-primary-500 hover:bg-primary-600 disabled:opacity-40 text-white text-base font-semibold transition-colors shadow-lg"
        >
          {saving ? 'Saving...' : isNew ? 'Create plan' : 'Save changes'}
        </button>
      </div>

      {/* Exercise picker */}
      {showPicker && (
        <AddExerciseSheet
          onClose={() => setShowPicker(false)}
          onAdd={handleAdd}
        />
      )}
    </>
  )
}
