import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Estimation, FoodLog, FoodSuggestion, Goals, GoalSuggestion, Macros, MealType, Micros } from '@fitness/shared-types'
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

function defaultMealType(): MealType {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 17 && h < 21) return 'dinner'
  return 'snack'
}

function defaultTimeStr(): string {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function mealGroup(log: FoodLog): 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' {
  if (log.meal_type) {
    const map: Record<MealType, 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks'> = {
      breakfast: 'Breakfast',
      lunch: 'Lunch',
      dinner: 'Dinner',
      snack: 'Snacks',
    }
    return map[log.meal_type]
  }
  const ts = log.logged_at ?? log.created_at
  if (!ts) return 'Snacks'
  const h = new Date(ts).getHours()
  if (h >= 5 && h < 11) return 'Breakfast'
  if (h >= 11 && h < 15) return 'Lunch'
  if (h >= 17 && h < 22) return 'Dinner'
  return 'Snacks'
}

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const
const MEAL_TYPE_OPTIONS: { label: string; value: MealType }[] = [
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Lunch', value: 'lunch' },
  { label: 'Dinner', value: 'dinner' },
  { label: 'Snack', value: 'snack' },
]

const MICROS_FIELDS: { key: keyof Micros; label: string; unit: string }[] = [
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { key: 'iron_mg', label: 'Iron', unit: 'mg' },
  { key: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg' },
  { key: 'saturated_fat_g', label: 'Sat. Fat', unit: 'g' },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg' },
]

function hasMicros(m: Micros | null | undefined): boolean {
  if (!m) return false
  return MICROS_FIELDS.some(({ key }) => (m[key] ?? 0) > 0)
}

const EMPTY_MICROS: Micros = {
  fiber_g: 0, sugar_g: 0, sodium_mg: 0, potassium_mg: 0, calcium_mg: 0,
  iron_mg: 0, vitamin_c_mg: 0, vitamin_d_mcg: 0, saturated_fat_g: 0, cholesterol_mg: 0,
}

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

function MicroBar({ value, goal, label, unit }: { value: number; goal: number; label: string; unit: string }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span>{Math.round(value)}{unit}{goal > 0 ? `/${Math.round(goal)}${unit}` : ''}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-teal-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible Micros panel
// ---------------------------------------------------------------------------

function MicrosPanel({ micros, source, targets }: {
  micros: Micros | null | undefined
  source?: 'ai' | 'usda' | null
  targets?: Micros | null
}) {
  const [open, setOpen] = useState(false)
  if (!micros) return null
  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700"
      >
        <span>{open ? 'v' : '>'} Micros</span>
        {source === 'usda' && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-xs font-semibold">USDA</span>
        )}
      </button>
      {open && micros && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
          {MICROS_FIELDS.map(({ key, label, unit }) => (
            <MicroBar
              key={key}
              label={label}
              unit={unit}
              value={micros[key] ?? 0}
              goal={targets?.[key] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Micros targets section (for goals modal)
// ---------------------------------------------------------------------------

function MicrosTargetsSection({ values, onChange }: {
  values: Partial<Record<keyof Micros, string>>
  onChange: (k: keyof Micros, v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700"
      >
        {open ? 'v' : '>'} Micros targets (optional)
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {MICROS_FIELDS.map(({ key, label, unit }) => (
            <div key={key}>
              <label className="block text-xs text-gray-400 mb-0.5">{label} ({unit})</label>
              <input
                type="number"
                min="0"
                className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
                placeholder="0"
                value={values[key] ?? ''}
                onChange={(e) => onChange(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview card (after estimation)
// ---------------------------------------------------------------------------

interface PreviewState {
  estimation: Estimation
  source: 'ai_text' | 'ai_photo' | 'favorite' | 'manual'
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
  const [mealType, setMealType] = useState<MealType>(defaultMealType())
  const initTime = defaultTimeStr()
  const [timeStr, setTimeStr] = useState(initTime)
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
    // Build logged_at only if user changed the time
    let logged_at: string | undefined
    if (timeStr !== initTime) {
      const [hh, mm] = timeStr.split(':')
      const dt = new Date()
      dt.setHours(Number(hh), Number(mm), 0, 0)
      logged_at = dt.toISOString()
    }
    try {
      if (state.editId) {
        await nutritionApi.logs.update(state.editId, { name, serving, macros })
        toast.success('Log updated')
      } else {
        const logSource = state.source
        await nutritionApi.logs.create({
          date,
          name,
          serving,
          macros,
          source: logSource,
          meal_type: mealType,
          ...(logged_at ? { logged_at } : {}),
          ...(state.estimation.micros ? { micros: state.estimation.micros } : {}),
          ...(state.estimation.usda_fdc_id != null ? { usda_fdc_id: state.estimation.usda_fdc_id } : {}),
          ...(state.estimation.micros_source ? { micros_source: state.estimation.micros_source } : {}),
        })
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

      {/* Meal type chips + time picker */}
      {!state.editId && (
        <div className="flex flex-wrap items-center gap-2">
          {MEAL_TYPE_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMealType(value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                mealType === value
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
          <input
            type="time"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 ml-auto"
          />
        </div>
      )}

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

      {/* Micros panel */}
      <MicrosPanel
        micros={state.estimation.micros}
        source={state.estimation.micros_source}
      />

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
              {hasMicros(suggestion.proposal.micros_targets) && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500 font-semibold mb-2">Suggested micros targets</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {MICROS_FIELDS.filter(({ key }) => (suggestion.proposal.micros_targets?.[key] ?? 0) > 0).map(({ key, label, unit }) => (
                      <div key={key} className="flex justify-between text-xs text-gray-600">
                        <span>{label}</span>
                        <span className="font-medium">{Math.round(suggestion.proposal.micros_targets![key]!)}{unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
// Goals set modal
// ---------------------------------------------------------------------------

function GoalsSetModal({
  current,
  onClose,
  onSave,
}: {
  current: Goals | null | undefined
  onClose: () => void
  onSave: (g: Goals) => void
}) {
  const [calories, setCalories] = useState(String(current?.calories ?? ''))
  const [protein, setProtein] = useState(String(current?.protein_g ?? ''))
  const [carbs, setCarbs] = useState(String(current?.carbs_g ?? ''))
  const [fat, setFat] = useState(String(current?.fat_g ?? ''))
  const [microsVals, setMicrosVals] = useState<Partial<Record<keyof Micros, string>>>(
    current?.micros_targets
      ? Object.fromEntries(
          MICROS_FIELDS.map(({ key }) => [key, String(current.micros_targets![key] ?? '')])
        ) as Partial<Record<keyof Micros, string>>
      : {}
  )

  const handleSave = () => {
    const anyMicro = MICROS_FIELDS.some(({ key }) => Number(microsVals[key] ?? 0) > 0)
    const micros_targets: Micros | undefined = anyMicro
      ? Object.fromEntries(MICROS_FIELDS.map(({ key }) => [key, Number(microsVals[key] ?? 0)])) as unknown as Micros
      : undefined
    onSave({
      calories: Number(calories),
      protein_g: Number(protein),
      carbs_g: Number(carbs),
      fat_g: Number(fat),
      ...(micros_targets ? { micros_targets } : {}),
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 flex flex-col gap-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-semibold text-gray-900">Set daily goals</span>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'kcal', val: calories, set: setCalories },
            { label: 'protein (g)', val: protein, set: setProtein },
            { label: 'carbs (g)', val: carbs, set: setCarbs },
            { label: 'fat (g)', val: fat, set: setFat },
          ].map(({ label, val, set }) => (
            <div key={label} className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">{label}</label>
              <input
                type="number"
                min="0"
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center"
                value={val}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          ))}
        </div>
        <MicrosTargetsSection
          values={microsVals}
          onChange={(k, v) => setMicrosVals((prev) => ({ ...prev, [k]: v }))}
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold"
          >
            Save goals
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">
            Cancel
          </button>
        </div>
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
  const [goalsModalOpen, setGoalsModalOpen] = useState(false)
  const [menuLog, setMenuLog] = useState<FoodLog | null>(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeLoading, setBarcodeLoading] = useState(false)

  const photoInputRef = useRef<HTMLInputElement>(null)
  const [suggestQ, setSuggestQ] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const { data: foodSuggestions = [] } = useQuery<FoodSuggestion[]>({
    queryKey: ['food-suggestions', suggestQ],
    queryFn: () => nutritionApi.suggestFoods(suggestQ, 10),
    enabled: composer === 'text',
    staleTime: 30_000,
  })

  const totals = dayLogs?.totals ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const microsTotals = dayLogs?.micros_totals
  const logs = dayLogs?.items ?? []

  // Group logs by meal type first, then time heuristic
  const grouped: Record<string, FoodLog[]> = {}
  for (const log of logs) {
    const g = mealGroup(log)
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(log)
  }

  // Reset autocomplete state when composer closes
  const closeComposer = () => {
    setComposer('idle')
    setTextInput('')
    setSuggestQ('')
    setHighlightIdx(-1)
  }

  // Select a food suggestion — fills preview directly, no AI call
  const handleSelectSuggestion = (s: FoodSuggestion) => {
    setPreview({
      estimation: { name: s.name, serving: s.serving, macros: s.macros, confidence: 1 },
      source: s.source === 'favorite' ? 'favorite' : 'manual',
    })
    closeComposer()
  }

  // Text estimation
  const handleEstimateText = async () => {
    if (!textInput.trim()) return
    setEstimating(true)
    try {
      const est = await nutritionApi.estimateText(textInput.trim())
      setPreview({ estimation: est, source: 'ai_text' })
      closeComposer()
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
      closeComposer()
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
        micros: log.micros ?? undefined,
        micros_source: log.micros_source,
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

  // Save goals directly
  const handleSaveGoals = async (g: Goals) => {
    try {
      await nutritionApi.goals.set(g)
      toast.success('Goals updated')
      void qc.invalidateQueries({ queryKey: ['goals'] })
    } catch {
      toast.error('Could not save goals')
    }
    setGoalsModalOpen(false)
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
            {/* Micros today */}
            <MicrosPanel
              micros={microsTotals ?? EMPTY_MICROS}
              source={null}
              targets={goals.micros_targets ?? undefined}
            />
            {!hasMicros(microsTotals) && (
              <p className="text-xs text-gray-400 mt-1">No micros logged yet today.</p>
            )}
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
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Type a meal</span>
              </button>
              <button
                onClick={() => photoInputRef.current?.click()}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <span>Camera</span>
              </button>
              <button
                onClick={() => setComposer('favorites')}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                <span>Favorites</span>
              </button>
              <button
                onClick={() => { setComposer('barcode'); setBarcodeInput(''); setBarcodeError(null) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v14"/></svg>
                <span>Barcode</span>
              </button>
            </div>
          )}

          {composer === 'text' && (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <textarea
                  autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="e.g. two scrambled eggs and toast with butter"
                  rows={2}
                  value={textInput}
                  onChange={(e) => {
                    const val = e.target.value
                    setTextInput(val)
                    setHighlightIdx(-1)
                    if (debounceRef.current) clearTimeout(debounceRef.current)
                    debounceRef.current = setTimeout(() => {
                      setSuggestQ(val.trim())
                    }, 200)
                  }}
                  onKeyDown={(e) => {
                    if (foodSuggestions.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setHighlightIdx((i) => Math.min(i + 1, foodSuggestions.length - 1))
                        return
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setHighlightIdx((i) => Math.max(i - 1, 0))
                        return
                      }
                      if (e.key === 'Escape') {
                        setSuggestQ('')
                        setHighlightIdx(-1)
                        return
                      }
                      if (e.key === 'Enter' && !e.shiftKey && highlightIdx >= 0) {
                        e.preventDefault()
                        handleSelectSuggestion(foodSuggestions[highlightIdx])
                        return
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleEstimateText()
                    }
                  }}
                />

                {/* Autocomplete dropdown */}
                {foodSuggestions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {foodSuggestions.map((s, idx) => (
                      <button
                        key={`${s.source}:${s.name}`}
                        onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s) }}
                        onMouseEnter={() => setHighlightIdx(idx)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 ${idx === highlightIdx ? 'bg-gray-50' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 truncate block">{s.name}</span>
                          {s.serving && (
                            <span className="text-xs text-gray-400">{s.serving}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-xs font-medium text-primary-600">{Math.round(s.macros.calories)} kcal</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${s.source === 'favorite' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                            {s.source === 'favorite' ? 'Saved' : 'Recent'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : textInput.trim().length > 0 ? (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                    <span className="text-xs text-gray-400">No matches. Press Enter to estimate with AI.</span>
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => void handleEstimateText()}
                  disabled={!textInput.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  Estimate
                </button>
                <button
                  onClick={closeComposer}
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
                  onClick={() => { closeComposer(); setBarcodeInput(''); setBarcodeError(null) }}
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
                onClick={closeComposer}
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSuggestOpen(true)}
              className="text-xs text-primary-600 font-medium hover:text-primary-700"
            >
              Suggest with AI
            </button>
            <button
              onClick={() => setGoalsModalOpen(true)}
              className="text-xs text-gray-500 font-medium hover:text-gray-700"
            >
              Edit
            </button>
          </div>
        </div>

        {goals ? (
          <>
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
            <div className="border-t border-gray-100 pt-2 mt-1">
              <span className="text-xs font-semibold text-gray-500 mb-1 block">Micros</span>
              <div className="grid grid-cols-5 gap-1">
                {MICROS_FIELDS.map(({ key, label, unit }) => {
                  const v = goals.micros_targets?.[key] ?? 0
                  return (
                    <div key={key} className="flex flex-col items-center bg-gray-50 rounded-lg p-1.5">
                      <span className={`text-xs font-semibold ${v > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                        {v > 0 ? `${Math.round(v)}${unit}` : '—'}
                      </span>
                      <span className="text-[10px] text-gray-400 leading-tight text-center">{label}</span>
                    </div>
                  )
                })}
              </div>
              {!hasMicros(goals.micros_targets) && (
                <p className="text-xs text-gray-400 mt-1">Tap Edit or Suggest with AI to set micro targets.</p>
              )}
            </div>
          </>
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

      {/* Goals set modal */}
      {goalsModalOpen && (
        <GoalsSetModal
          current={goals}
          onClose={() => setGoalsModalOpen(false)}
          onSave={(g) => void handleSaveGoals(g)}
        />
      )}
    </div>
  )
}
