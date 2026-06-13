import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Estimation, FoodLog, Goals, GoalSuggestion, Macros } from '@fitness/shared-types'
import { nutritionApi, uploadsApi } from '../services/api'
// nutritionApi.barcode is used inline below
import { toLocalISODate } from '../lib/dates'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prevDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return toLocalISODate(d)
}

function nextDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return toLocalISODate(d)
}

function formatDate(iso: string): string {
  const today = toLocalISODate()
  if (iso === today) return 'Today'
  const yesterday = prevDate(today)
  if (iso === yesterday) return 'Yesterday'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function mealGroup(log: FoodLog): 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' {
  if (!log.created_at) return 'Snacks'
  const h = new Date(log.created_at).getHours()
  if (h >= 5 && h < 11) return 'Breakfast'
  if (h >= 11 && h < 15) return 'Lunch'
  if (h >= 17 && h < 22) return 'Dinner'
  return 'Snacks'
}

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const

function MacroBar({ value, goal, label }: { value: number; goal: number; label: string }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span>{Math.round(value)}{goal > 0 ? `/${Math.round(goal)}g` : 'g'}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview card (after estimation)
// ---------------------------------------------------------------------------

interface PreviewState {
  estimation: Estimation
  source: 'ai_text' | 'ai_photo'
  editId?: string // set when editing existing log
}

function PreviewCard({
  state,
  date,
  onSaved,
  onCancel,
}: {
  state: PreviewState
  date: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(state.estimation.name)
  const [serving, setServing] = useState(state.estimation.serving)
  const [calories, setCalories] = useState(String(Math.round(state.estimation.macros.calories)))
  const [protein, setProtein] = useState(String(Math.round(state.estimation.macros.protein_g)))
  const [carbs, setCarbs] = useState(String(Math.round(state.estimation.macros.carbs_g)))
  const [fat, setFat] = useState(String(Math.round(state.estimation.macros.fat_g)))
  const [saving, setSaving] = useState(false)
  const qc = useQueryClient()

  const confidence = Math.round(state.estimation.confidence * 100)

  const handleSave = async () => {
    setSaving(true)
    const macros: Macros = {
      calories: Number(calories),
      protein_g: Number(protein),
      carbs_g: Number(carbs),
      fat_g: Number(fat),
    }
    try {
      if (state.editId) {
        await nutritionApi.logs.update(state.editId, { name, serving, macros })
        toast.success('Log updated')
      } else {
        await nutritionApi.logs.create({ date, name, serving, macros, source: state.source })
        toast.success('Logged')
      }
      void qc.invalidateQueries({ queryKey: ['day-logs', date] })
      onSaved()
    } catch {
      toast.error('Could not save log')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">
          {state.editId ? 'Edit log' : 'Confirm entry'}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
          {confidence}% confident
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Food name"
        />
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={serving}
          onChange={(e) => setServing(e.target.value)}
          placeholder="Serving size"
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'kcal', val: calories, set: setCalories },
          { label: 'protein', val: protein, set: setProtein },
          { label: 'carbs', val: carbs, set: setCarbs },
          { label: 'fat', val: fat, set: setFat },
        ].map(({ label, val, set }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <input
              type="number"
              min="0"
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center"
              value={val}
              onChange={(e) => set(e.target.value)}
            />
            <span className="text-xs text-gray-400">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goals suggestion modal
// ---------------------------------------------------------------------------

function GoalsSuggestModal({
  onClose,
  onAccept,
}: {
  onClose: () => void
  onAccept: (g: Goals) => void
}) {
  const [bodyweight, setBodyweight] = useState('')
  const [goalText, setGoalText] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestion, setSuggestion] = useState<GoalSuggestion | null>(null)

  const handleSuggest = async () => {
    setLoading(true)
    try {
      const params: { bodyweight_kg?: number; goal_text?: string } = {}
      if (bodyweight) params.bodyweight_kg = Number(bodyweight)
      if (goalText) params.goal_text = goalText
      const s = await nutritionApi.goals.suggest(params)
      setSuggestion(s)
    } catch {
      toast.error('Could not get suggestion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-semibold text-gray-900">Suggest daily goals</span>

        {!suggestion ? (
          <>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bodyweight (kg) - optional</label>
                <input
                  type="number"
                  min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 80"
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Your goal - optional</label>
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="e.g. lose fat while maintaining muscle"
                  rows={2}
                  value={goalText}
                  onChange={(e) => setGoalText(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleSuggest()}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold disabled:opacity-60"
              >
                {loading ? 'Getting suggestion...' : 'Get suggestion'}
              </button>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-xs text-gray-500 italic">{suggestion.rationale}</p>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {([
                  ['kcal', suggestion.proposal.calories],
                  ['protein', suggestion.proposal.protein_g],
                  ['carbs', suggestion.proposal.carbs_g],
                  ['fat', suggestion.proposal.fat_g],
                ] as [string, number][]).map(([label, val]) => (
                  <div key={label} className="flex flex-col items-center">
                    <span className="text-sm font-semibold text-gray-800">{Math.round(val)}</span>
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onAccept(suggestion.proposal)}
                className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold"
              >
                Accept
              </button>
              <button onClick={() => setSuggestion(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">
                Edit inputs
              </button>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Composer = 'idle' | 'text' | 'photo' | 'favorites' | 'barcode'

export default function Nutrition() {
  const today = toLocalISODate()
  const [date, setDate] = useState(today)
  const [composer, setComposer] = useState<Composer>('idle')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [textInput, setTextInput] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [menuLog, setMenuLog] = useState<FoodLog | null>(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeLoading, setBarcodeLoading] = useState(false)

  const photoInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: dayLogs, isLoading: loadingLogs } = useQuery({
    queryKey: ['day-logs', date],
    queryFn: () => nutritionApi.logs.list(date),
  })

  const { data: goals } = useQuery({
    queryKey: ['goals'],
    queryFn: () => nutritionApi.goals.get(),
  })

  const { data: favorites = [] } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => nutritionApi.favorites.list(),
    enabled: composer === 'favorites',
  })

  const totals = dayLogs?.totals ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const logs = dayLogs?.items ?? []

  // Group logs by meal time
  const grouped: Record<string, FoodLog[]> = {}
  for (const log of logs) {
    const g = mealGroup(log)
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(log)
  }

  // Text estimation
  const handleEstimateText = async () => {
    if (!textInput.trim()) return
    setEstimating(true)
    try {
      const est = await nutritionApi.estimateText(textInput.trim())
      setPreview({ estimation: est, source: 'ai_text' })
      setComposer('idle')
      setTextInput('')
    } catch {
      toast.error('Could not estimate. Try rephrasing.')
    } finally {
      setEstimating(false)
    }
  }

  // Photo estimation
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setEstimating(true)
    setComposer('idle')
    try {
      const signed = await uploadsApi.signFoodPhoto(file.type)
      // PUT directly to signed URL - no Authorization header
      const putRes = await fetch(signed.upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!putRes.ok) throw new Error('Upload failed')
      const est = await nutritionApi.estimatePhoto(signed.public_url)
      setPreview({ estimation: est, source: 'ai_photo' })
    } catch {
      toast.error('Could not process photo. Try again.')
    } finally {
      setEstimating(false)
      // reset input so same file can be re-selected
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  // Log from favorite
  const handleLogFavorite = async (favId: string) => {
    try {
      await nutritionApi.favorites.log(favId, date)
      toast.success('Logged from favorites')
      void qc.invalidateQueries({ queryKey: ['day-logs', date] })
      void qc.invalidateQueries({ queryKey: ['favorites'] })
      setComposer('idle')
    } catch {
      toast.error('Could not log favorite')
    }
  }

  // Barcode lookup
  const handleBarcodeLookup = async () => {
    const code = barcodeInput.trim()
    if (!code) return
    setBarcodeError(null)
    setBarcodeLoading(true)
    try {
      const est = await nutritionApi.barcode(code)
      setPreview({ estimation: est, source: 'ai_text' })
      setComposer('idle')
      setBarcodeInput('')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        setBarcodeError('Product not found.')
      } else {
        setBarcodeError('Lookup failed. Check the code and try again.')
      }
    } finally {
      setBarcodeLoading(false)
    }
  }

  // Delete log
  const handleDelete = async (id: string) => {
    try {
      await nutritionApi.logs.remove(id)
      toast.success('Removed')
      void qc.invalidateQueries({ queryKey: ['day-logs', date] })
    } catch {
      toast.error('Could not delete log')
    }
    setMenuLog(null)
  }

  // Save as favorite
  const handleSaveAsFavorite = async (log: FoodLog) => {
    try {
      await nutritionApi.favorites.create({ name: log.name, serving: log.serving, macros: log.macros })
      toast.success('Saved as favorite')
      void qc.invalidateQueries({ queryKey: ['favorites'] })
    } catch {
      toast.error('Could not save favorite')
    }
    setMenuLog(null)
  }

  // Edit log - open preview with existing data
  const handleEdit = (log: FoodLog) => {
    setPreview({
      estimation: {
        name: log.name,
        serving: log.serving,
        macros: log.macros,
        confidence: 1,
      },
      source: 'ai_text',
      editId: log.id,
    })
    setMenuLog(null)
  }

  // Accept goal suggestion
  const handleAcceptGoals = async (g: Goals) => {
    try {
      await nutritionApi.goals.set(g)
      toast.success('Goals updated')
      void qc.invalidateQueries({ queryKey: ['goals'] })
    } catch {
      toast.error('Could not save goals')
    }
    setSuggestOpen(false)
  }

  const isToday = date === today

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">

      {/* Date strip */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => { setDate(prevDate(date)); setComposer('idle'); setPreview(null) }}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 font-medium"
        >
          &lt; Prev
        </button>
        <span className="text-sm font-semibold text-gray-900">{formatDate(date)}</span>
        <button
          onClick={() => { if (!isToday) { setDate(nextDate(date)); setComposer('idle'); setPreview(null) } }}
          disabled={isToday}
          className="px-3 py-1.5 text-sm font-medium disabled:text-gray-200 text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed"
        >
          Next &gt;
        </button>
      </div>

      {/* Totals card */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Today's nutrition</span>
          <span className="text-lg font-bold text-primary-600">{Math.round(totals.calories)} kcal</span>
        </div>

        {goals ? (
          <>
            <div className="flex items-center gap-1">
              <div className="h-2.5 rounded-full bg-gray-100 flex-1 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary-500 transition-all"
                  style={{ width: `${Math.min(100, (totals.calories / goals.calories) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 ml-1">{Math.round(goals.calories)} goal</span>
            </div>
            <div className="flex gap-3">
              <MacroBar value={totals.protein_g} goal={goals.protein_g} label="protein" />
              <MacroBar value={totals.carbs_g} goal={goals.carbs_g} label="carbs" />
              <MacroBar value={totals.fat_g} goal={goals.fat_g} label="fat" />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-4 text-sm text-gray-500">
              <span>P: {Math.round(totals.protein_g)}g</span>
              <span>C: {Math.round(totals.carbs_g)}g</span>
              <span>F: {Math.round(totals.fat_g)}g</span>
            </div>
            <p className="text-xs text-gray-400">No goals set. Set them to track progress.</p>
          </div>
        )}
      </div>

      {/* Preview card (estimation result) */}
      {preview && (
        <PreviewCard
          state={preview}
          date={date}
          onSaved={() => setPreview(null)}
          onCancel={() => setPreview(null)}
        />
      )}

      {/* Estimating spinner */}
      {estimating && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
          <span className="text-sm text-gray-500">Estimating...</span>
        </div>
      )}

      {/* Composer */}
      {!preview && !estimating && (
        <div className="card p-4 flex flex-col gap-3">
          <span className="text-sm font-semibold text-gray-900">Log food</span>

          {composer === 'idle' && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setComposer('text')}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50"
              >
                [T] Type a meal
              </button>
              <button
                onClick={() => photoInputRef.current?.click()}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50"
              >
                [C] Camera
              </button>
              <button
                onClick={() => setComposer('favorites')}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50"
              >
                [*] Favorites
              </button>
              <button
                onClick={() => { setComposer('barcode'); setBarcodeInput(''); setBarcodeError(null) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50"
              >
                [B] Barcode
              </button>
            </div>
          )}

          {composer === 'text' && (
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="e.g. two scrambled eggs and toast with butter"
                rows={2}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleEstimateText() } }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleEstimateText()}
                  disabled={!textInput.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  Estimate
                </button>
                <button
                  onClick={() => { setComposer('idle'); setTextInput('') }}
                  className="py-2.5 px-4 rounded-xl border border-gray-200 text-sm text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {composer === 'barcode' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-500">Enter the numeric barcode from the package</label>
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. 5449000000996"
                value={barcodeInput}
                onChange={(e) => { setBarcodeInput(e.target.value); setBarcodeError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleBarcodeLookup() }}
              />
              {barcodeError && (
                <p className="text-xs text-red-500">{barcodeError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => void handleBarcodeLookup()}
                  disabled={!barcodeInput.trim() || barcodeLoading}
                  className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {barcodeLoading ? 'Looking up...' : 'Look up'}
                </button>
                <button
                  onClick={() => { setComposer('idle'); setBarcodeInput(''); setBarcodeError(null) }}
                  className="py-2.5 px-4 rounded-xl border border-gray-200 text-sm text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {composer === 'favorites' && (
            <div className="flex flex-col gap-2">
              {favorites.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">
                  Save your recurring meals as favorites to log them in one tap.
                </p>
              ) : (
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  {[...favorites].sort((a, b) => {
                    if (!a.last_used_at) return 1
                    if (!b.last_used_at) return -1
                    return b.last_used_at.localeCompare(a.last_used_at)
                  }).map((fav) => (
                    <button
                      key={fav.id}
                      onClick={() => void handleLogFavorite(fav.id)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 border border-gray-100"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">{fav.name}</span>
                        <span className="text-xs text-primary-600 font-medium">{Math.round(fav.macros.calories)} kcal</span>
                      </div>
                      {fav.serving && (
                        <span className="text-xs text-gray-400">{fav.serving}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setComposer('idle')}
                className="py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hidden photo input */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handlePhotoChange(e)}
      />

      {/* Day log list */}
      <div className="flex flex-col gap-3">
        {loadingLogs ? (
          <div className="card p-4 bg-gray-50 animate-pulse h-20" />
        ) : logs.length === 0 ? (
          <div className="card p-4">
            <p className="text-sm text-gray-400">
              No food logged yet. Snap a photo or type a meal to start.
            </p>
          </div>
        ) : (
          MEAL_ORDER.filter((g) => grouped[g]?.length).map((group) => (
            <div key={group} className="card p-4 flex flex-col gap-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{group}</span>
              {grouped[group].map((log) => (
                <div key={log.id} className="flex items-start justify-between gap-2 py-1 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{log.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {log.serving && <span>{log.serving} - </span>}
                      {Math.round(log.macros.calories)} kcal | P {Math.round(log.macros.protein_g)}g C {Math.round(log.macros.carbs_g)}g F {Math.round(log.macros.fat_g)}g
                    </p>
                  </div>
                  <button
                    onClick={() => setMenuLog(menuLog?.id === log.id ? null : log)}
                    className="text-gray-400 hover:text-gray-700 px-1 py-0.5 text-lg leading-none flex-shrink-0"
                    aria-label="Options"
                  >
                    ...
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Per-row actions menu */}
      {menuLog && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center p-4" onClick={() => setMenuLog(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-2 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            <p className="px-4 py-2 text-sm font-semibold text-gray-800 truncate">{menuLog.name}</p>
            <button
              onClick={() => handleEdit(menuLog)}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-xl"
            >
              Edit
            </button>
            <button
              onClick={() => void handleSaveAsFavorite(menuLog)}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-xl"
            >
              Save as favorite
            </button>
            <button
              onClick={() => void handleDelete(menuLog.id)}
              className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 rounded-xl"
            >
              Delete
            </button>
            <button
              onClick={() => setMenuLog(null)}
              className="w-full text-left px-4 py-3 text-sm text-gray-400 hover:bg-gray-50 rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Goals card */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Daily goals</span>
          <button
            onClick={() => setSuggestOpen(true)}
            className="text-xs text-primary-600 font-medium hover:text-primary-700"
          >
            Suggest with AI
          </button>
        </div>

        {goals ? (
          <div className="grid grid-cols-4 gap-2">
            {([
              ['kcal', goals.calories],
              ['protein', goals.protein_g],
              ['carbs', goals.carbs_g],
              ['fat', goals.fat_g],
            ] as [string, number][]).map(([label, val]) => (
              <div key={label} className="flex flex-col items-center bg-gray-50 rounded-xl p-2">
                <span className="text-sm font-semibold text-gray-800">{Math.round(val)}</span>
                <span className="text-xs text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No goals set. Set them to track progress.
          </p>
        )}
      </div>

      {/* Goals suggestion modal */}
      {suggestOpen && (
        <GoalsSuggestModal
          onClose={() => setSuggestOpen(false)}
          onAccept={(g) => void handleAcceptGoals(g)}
        />
      )}
    </div>
  )
}
