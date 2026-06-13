import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { BodyMetric, BodyMetricCreate, BodyMetricUpdate } from '@fitness/shared-types'
import { bodyApi, uploadsApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-100 rounded-xl animate-pulse ${className}`} />
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

interface FormState {
  date: string
  weight_kg: string
  body_fat_pct: string
  waist_cm: string
  chest_cm: string
  arm_cm: string
  thigh_cm: string
  notes: string
}

const EMPTY_FORM: FormState = {
  date: toLocalISODate(),
  weight_kg: '',
  body_fat_pct: '',
  waist_cm: '',
  chest_cm: '',
  arm_cm: '',
  thigh_cm: '',
  notes: '',
}

function metricToForm(m: BodyMetric): FormState {
  return {
    date: m.date,
    weight_kg: String(m.weight_kg),
    body_fat_pct: m.body_fat_pct != null ? String(m.body_fat_pct) : '',
    waist_cm: m.waist_cm != null ? String(m.waist_cm) : '',
    chest_cm: m.chest_cm != null ? String(m.chest_cm) : '',
    arm_cm: m.arm_cm != null ? String(m.arm_cm) : '',
    thigh_cm: m.thigh_cm != null ? String(m.thigh_cm) : '',
    notes: m.notes ?? '',
  }
}

function formToPayload(f: FormState): BodyMetricCreate {
  const num = (s: string) => s.trim() === '' ? null : parseFloat(s)
  return {
    date: f.date,
    weight_kg: parseFloat(f.weight_kg),
    body_fat_pct: num(f.body_fat_pct),
    waist_cm: num(f.waist_cm),
    chest_cm: num(f.chest_cm),
    arm_cm: num(f.arm_cm),
    thigh_cm: num(f.thigh_cm),
    notes: f.notes,
  }
}

interface AddFormProps {
  onSaved: () => void
  onCancel?: () => void
  editMetric?: BodyMetric | null
}

function MetricForm({ onSaved, onCancel, editMetric = null }: AddFormProps) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormState>(editMetric ? metricToForm(editMetric) : EMPTY_FORM)
  const [photoUrls, setPhotoUrls] = useState<string[]>(editMetric?.photo_urls ?? [])
  const [uploading, setUploading] = useState(false)

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const createMutation = useMutation({
    mutationFn: (payload: BodyMetricCreate) => bodyApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['body'] })
      toast.success('Check-in saved')
      onSaved()
    },
    onError: () => toast.error('Failed to save'),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: BodyMetricUpdate) => bodyApi.update(editMetric!.id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['body'] })
      toast.success('Updated')
      onSaved()
    },
    onError: () => toast.error('Failed to update'),
  })

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { upload_url, public_url } = await uploadsApi.signFoodPhoto(file.type)
      await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      setPhotoUrls((prev) => [...prev, public_url])
      toast.success('Photo uploaded')
    } catch {
      toast.error('Photo upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = () => {
    const w = parseFloat(form.weight_kg)
    if (!form.date.match(/^\d{4}-\d{2}-\d{2}$/) || isNaN(w) || w <= 0) {
      toast.error('Date and weight (> 0) are required')
      return
    }
    const payload = { ...formToPayload(form), photo_urls: photoUrls }
    if (editMetric) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { date: _d, ...updatePayload } = payload
      updateMutation.mutate({ ...updatePayload, photo_urls: photoUrls })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending || uploading

  return (
    <div className="card p-4 flex flex-col gap-3">
      <span className="text-sm font-semibold text-gray-900">
        {editMetric ? 'Edit check-in' : 'Log check-in'}
      </span>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Date *</label>
          <input type="date" value={form.date} onChange={set('date')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Weight (kg) *</label>
          <input type="number" inputMode="decimal" step="0.1" min="0.1" max="400"
            value={form.weight_kg} onChange={set('weight_kg')} placeholder="e.g. 80.5"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Body fat %</label>
          <input type="number" inputMode="decimal" step="0.1" min="2" max="70"
            value={form.body_fat_pct} onChange={set('body_fat_pct')} placeholder="optional"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Waist (cm)</label>
          <input type="number" inputMode="decimal" step="0.5"
            value={form.waist_cm} onChange={set('waist_cm')} placeholder="optional"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Chest (cm)</label>
          <input type="number" inputMode="decimal" step="0.5"
            value={form.chest_cm} onChange={set('chest_cm')} placeholder="-"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Arm (cm)</label>
          <input type="number" inputMode="decimal" step="0.5"
            value={form.arm_cm} onChange={set('arm_cm')} placeholder="-"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Thigh (cm)</label>
          <input type="number" inputMode="decimal" step="0.5"
            value={form.thigh_cm} onChange={set('thigh_cm')} placeholder="-"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Notes</label>
        <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Optional notes"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white resize-none" />
      </div>

      {/* Photo upload */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Progress photo (optional)</label>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        <button type="button" onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-xs text-primary-600 font-medium hover:text-primary-700 disabled:opacity-50">
          {uploading ? 'Uploading...' : '+ Add photo'}
        </button>
        {photoUrls.length > 0 && (
          <div className="flex gap-2 mt-2 flex-wrap">
            {photoUrls.map((url, i) => (
              <img key={i} src={url} alt="progress" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 font-medium">
            Cancel
          </button>
        )}
        <button onClick={handleSubmit} disabled={isPending}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
          {editMetric ? 'Save changes' : 'Save check-in'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Body() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data: metrics = [], isLoading } = useQuery<BodyMetric[]>({
    queryKey: ['body', { limit: 90 }],
    queryFn: () => bodyApi.list({ limit: 90 }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => bodyApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['body'] })
      setDeleteConfirmId(null)
      toast.success('Deleted')
    },
    onError: () => toast.error('Delete failed'),
  })

  const latest = metrics[0] ?? null

  // delta vs entry closest to 30 days ago
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = toLocalISODate(thirtyDaysAgo)
  const priorEntry = metrics.find((m) => m.date <= thirtyDaysAgoStr) ?? null
  const delta30 =
    latest && priorEntry && priorEntry.id !== latest.id
      ? latest.weight_kg - priorEntry.weight_kg
      : null

  // chart data: ascending by date for the line chart
  const chartMetrics = [...metrics].sort((a, b) => a.date.localeCompare(b.date))

  const editMetric = editId ? (metrics.find((m) => m.id === editId) ?? null) : null

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">

      {/* Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-gray-900">Body metrics</span>
          <button
            onClick={() => { setShowForm((s) => !s); setEditId(null) }}
            className="text-xs text-primary-600 font-medium hover:text-primary-700"
          >
            {showForm ? 'Cancel' : '+ Log check-in'}
          </button>
        </div>
        {isLoading ? (
          <Skeleton className="h-8" />
        ) : !latest ? (
          <p className="text-sm text-gray-400">No check-ins yet. Log your first one below.</p>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{latest.weight_kg} kg</span>
            {delta30 !== null && (
              <span className={`text-sm font-medium ${delta30 < 0 ? 'text-green-600' : delta30 > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {delta30 > 0 ? '+' : ''}{delta30.toFixed(1)} vs 30 days ago
              </span>
            )}
          </div>
        )}
      </div>

      {/* Add form */}
      {showForm && !editId && (
        <MetricForm
          onSaved={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Edit form */}
      {editId && editMetric && (
        <MetricForm
          editMetric={editMetric}
          onSaved={() => setEditId(null)}
          onCancel={() => setEditId(null)}
        />
      )}

      {/* Weight chart */}
      {chartMetrics.length > 1 && (
        <div className="card p-4">
          <span className="text-sm font-semibold text-gray-900 block mb-3">Weight (last 90 days)</span>
          <Line
            data={{
              labels: chartMetrics.map((m) => m.date),
              datasets: [
                {
                  label: 'Weight (kg)',
                  data: chartMetrics.map((m) => m.weight_kg),
                  borderColor: '#3b82f6',
                  backgroundColor: 'rgba(59,130,246,0.1)',
                  tension: 0.3,
                  pointRadius: 3,
                  fill: true,
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false },
              },
              scales: {
                x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } },
                y: {
                  title: { display: true, text: 'kg', font: { size: 10 } },
                  ticks: { font: { size: 10 } },
                },
              },
            }}
          />
        </div>
      )}

      {/* Entries list */}
      <div className="card p-4">
        <span className="text-sm font-semibold text-gray-900 block mb-3">History</span>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : metrics.length === 0 ? (
          <p className="text-sm text-gray-400">No check-ins yet. Log your weight to track changes.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {metrics.map((m) => (
              <div key={m.id} className="py-3 first:pt-0 last:pb-0">
                {deleteConfirmId === m.id ? (
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-600">Delete this check-in?</span>
                    <button
                      onClick={() => deleteMutation.mutate(m.id)}
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
                        <span className="text-sm font-semibold text-gray-900">{m.weight_kg} kg</span>
                        <span className="text-xs text-gray-400">{formatDate(m.date)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {m.body_fat_pct != null && (
                          <span className="text-xs text-gray-500">{m.body_fat_pct}% fat</span>
                        )}
                        {m.waist_cm != null && (
                          <span className="text-xs text-gray-500">waist {m.waist_cm} cm</span>
                        )}
                        {m.arm_cm != null && (
                          <span className="text-xs text-gray-500">arm {m.arm_cm} cm</span>
                        )}
                        {m.thigh_cm != null && (
                          <span className="text-xs text-gray-500">thigh {m.thigh_cm} cm</span>
                        )}
                      </div>
                      {m.notes && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{m.notes}</p>
                      )}
                      {m.photo_urls && m.photo_urls.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {m.photo_urls.map((url, i) => (
                            <img key={i} src={url} alt="progress" className="h-10 w-10 object-cover rounded border border-gray-200" />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => { setEditId(m.id); setShowForm(false) }}
                        className="text-xs text-primary-600 font-medium hover:text-primary-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(m.id)}
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
