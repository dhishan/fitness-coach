import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { CardioLog, CardioLogCreate, CardioLogUpdate, CardioType } from '@fitness/shared-types'
import { cardioApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0 && sec > 0) return `${m}m ${sec}s`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

function formatDistance(m: number): string {
  if (m === 0) return ''
  return `${(m / 1000).toFixed(2)} km`
}

const TYPE_LABELS: Record<CardioType, string> = {
  run: 'Run',
  ride: 'Ride',
  walk: 'Walk',
  swim: 'Swim',
  other: 'Other',
}

const TYPES: CardioType[] = ['run', 'ride', 'walk', 'swim', 'other']

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface FormState {
  date: string
  type: CardioType
  mins: string
  secs: string
  distance_km: string
  avg_hr: string
  calories: string
  notes: string
}

const EMPTY_FORM: FormState = {
  date: toLocalISODate(),
  type: 'run',
  mins: '',
  secs: '',
  distance_km: '',
  avg_hr: '',
  calories: '',
  notes: '',
}

function logToForm(log: CardioLog): FormState {
  const totalSecs = log.duration_s
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  return {
    date: log.date,
    type: log.type,
    mins: String(m),
    secs: s > 0 ? String(s) : '',
    distance_km: log.distance_m > 0 ? String(log.distance_m / 1000) : '',
    avg_hr: log.avg_hr != null ? String(log.avg_hr) : '',
    calories: log.calories != null ? String(log.calories) : '',
    notes: log.notes ?? '',
  }
}

function formToDurationS(f: FormState): number {
  const m = parseInt(f.mins || '0', 10)
  const s = parseInt(f.secs || '0', 10)
  return m * 60 + s
}

interface FormProps {
  onSaved: () => void
  onCancel: () => void
  editLog?: CardioLog | null
}

function CardioForm({ onSaved, onCancel, editLog = null }: FormProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(editLog ? logToForm(editLog) : EMPTY_FORM)

  const set = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const createMutation = useMutation({
    mutationFn: (payload: CardioLogCreate) => cardioApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cardio'] })
      toast.success('Session logged')
      onSaved()
    },
    onError: () => toast.error('Failed to save'),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: CardioLogUpdate) => cardioApi.update(editLog!.id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cardio'] })
      toast.success('Updated')
      onSaved()
    },
    onError: () => toast.error('Failed to update'),
  })

  const handleSubmit = () => {
    const durationS = formToDurationS(form)
    if (!form.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      toast.error('Invalid date')
      return
    }
    if (durationS <= 0) {
      toast.error('Duration must be greater than 0')
      return
    }

    const distM = form.distance_km.trim() ? parseFloat(form.distance_km) * 1000 : 0
    const avgHr = form.avg_hr.trim() ? parseInt(form.avg_hr, 10) : null
    const cals = form.calories.trim() ? parseInt(form.calories, 10) : null

    if (editLog) {
      updateMutation.mutate({
        type: form.type,
        duration_s: durationS,
        distance_m: distM,
        avg_hr: avgHr,
        calories: cals,
        notes: form.notes,
      })
    } else {
      createMutation.mutate({
        date: form.date,
        type: form.type,
        duration_s: durationS,
        distance_m: distM,
        avg_hr: avgHr,
        calories: cals,
        notes: form.notes,
        source: 'manual',
      })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="card p-4 flex flex-col gap-3">
      <span className="text-sm font-semibold text-gray-900">
        {editLog ? 'Edit session' : 'Log cardio session'}
      </span>

      {/* Type chips */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Type</label>
        <div className="flex gap-2 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, type: t }))}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                form.type === t
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Date */}
      {!editLog && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">Date *</label>
          <input
            type="date"
            value={form.date}
            onChange={set('date')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
          />
        </div>
      )}

      {/* Duration */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Duration *</label>
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={form.mins}
              onChange={set('mins')}
              placeholder="min"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
            />
          </div>
          <span className="text-sm text-gray-400">m</span>
          <div className="flex-1">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              value={form.secs}
              onChange={set('secs')}
              placeholder="sec"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
            />
          </div>
          <span className="text-sm text-gray-400">s</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Distance (km)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.distance_km}
            onChange={set('distance_km')}
            placeholder="optional"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Avg HR (bpm)</label>
          <input
            type="number"
            inputMode="numeric"
            min="20"
            max="240"
            value={form.avg_hr}
            onChange={set('avg_hr')}
            placeholder="optional"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Calories (kcal)</label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={form.calories}
            onChange={set('calories')}
            placeholder="optional"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={set('notes')}
          rows={2}
          placeholder="Optional notes"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white resize-none"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {editLog ? 'Save changes' : 'Save session'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Cardio() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery<CardioLog[]>({
    queryKey: ['cardio', { limit: 100 }],
    queryFn: () => cardioApi.list({ limit: 100 }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cardioApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cardio'] })
      setDeleteConfirmId(null)
      toast.success('Deleted')
    },
    onError: () => toast.error('Delete failed'),
  })

  const editLog = editId ? (logs.find((l) => l.id === editId) ?? null) : null

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">

      {/* Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-gray-900">Cardio</span>
          <button
            onClick={() => { setShowForm((s) => !s); setEditId(null) }}
            className="text-xs text-primary-600 font-medium hover:text-primary-700"
          >
            {showForm ? 'Cancel' : '+ Log session'}
          </button>
        </div>
        <p className="text-xs text-gray-400">Log runs, rides, walks, swims, and more.</p>
      </div>

      {/* Add form */}
      {showForm && !editId && (
        <CardioForm
          onSaved={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Edit form */}
      {editId && editLog && (
        <CardioForm
          editLog={editLog}
          onSaved={() => setEditId(null)}
          onCancel={() => setEditId(null)}
        />
      )}

      {/* History */}
      <div className="card p-4">
        <span className="text-sm font-semibold text-gray-900 block mb-3">History</span>
        {isLoading ? (
          <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ) : logs.length === 0 ? (
          <p className="text-sm text-gray-400">No cardio logged yet. Log a session to start tracking.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {logs.map((log) => (
              <div key={log.id} className="py-3 first:pt-0 last:pb-0">
                {deleteConfirmId === log.id ? (
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-600">Delete this session?</span>
                    <button
                      onClick={() => deleteMutation.mutate(log.id)}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-500 font-semibold hover:text-red-600 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-gray-900">{TYPE_LABELS[log.type]}</span>
                        <span className="text-xs text-gray-400">{formatDate(log.date)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="text-xs text-gray-500">{formatDuration(log.duration_s)}</span>
                        {log.distance_m > 0 && (
                          <span className="text-xs text-gray-500">{formatDistance(log.distance_m)}</span>
                        )}
                        {log.avg_hr != null && (
                          <span className="text-xs text-gray-500">{log.avg_hr} bpm</span>
                        )}
                        {log.calories != null && (
                          <span className="text-xs text-gray-500">{log.calories} kcal</span>
                        )}
                      </div>
                      {log.notes && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{log.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => { setEditId(log.id); setShowForm(false) }}
                        className="text-xs text-primary-600 font-medium hover:text-primary-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(log.id)}
                        className="text-xs text-red-400 font-medium hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
