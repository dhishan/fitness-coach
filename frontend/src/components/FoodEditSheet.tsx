import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { FoodLogCreate, Macros, MealType, Micros } from '@fitness/shared-types'
import { nutritionApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'

export interface FoodHit {
  name: string
  serving: string
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  micros?: Record<string, number> | null
  source?: string | null
  usda_fdc_id?: number | null
  data_type?: string
}

interface Props {
  open: boolean
  hit: FoodHit | null
  date: string
  initialMeal?: MealType
  onClose: () => void
  onLogged: () => void
}

const MEAL_OPTIONS: { label: string; value: MealType }[] = [
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Lunch', value: 'lunch' },
  { label: 'Dinner', value: 'dinner' },
  { label: 'Snack', value: 'snack' },
]

const MEAL_DEFAULT_TIMES: Record<MealType, { h: number; m: number }> = {
  breakfast: { h: 8, m: 0 },
  lunch: { h: 13, m: 0 },
  snack: { h: 16, m: 0 },
  dinner: { h: 19, m: 30 },
}

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

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  ifct: { bg: '#fef3c7', fg: '#b45309', label: 'IFCT' },
  usda: { bg: '#dbeafe', fg: '#2563eb', label: 'USDA' },
  off: { bg: '#ede9fe', fg: '#7c3aed', label: 'OFF' },
  recent: { bg: '#fff7ed', fg: '#ea580c', label: 'Recent' },
  recipe: { bg: '#ecfdf5', fg: '#16a34a', label: 'Recipe' },
  favorite: { bg: '#fef2f2', fg: '#dc2626', label: 'Favorite' },
}

const SERVING_QUICK = [0.5, 1, 1.5, 2, 3]

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function defaultMealForHour(): MealType {
  const h = new Date().getHours()
  if (h >= 4 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 15 && h < 18) return 'snack'
  if (h >= 18 && h < 23) return 'dinner'
  return 'snack'
}

function mealDefaultTime(meal: MealType, isoDate: string): string {
  const { h, m } = MEAL_DEFAULT_TIMES[meal]
  const [y, mo, d] = isoDate.split('-').map(Number)
  const t = new Date(y, mo - 1, d, h, m, 0)
  const now = new Date()
  const effective = t < now ? now : t
  return `${String(effective.getHours()).padStart(2, '0')}:${String(effective.getMinutes()).padStart(2, '0')}`
}

function buildLoggedAt(isoDate: string, timeStr: string): string {
  const [y, mo, d] = isoDate.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  return new Date(y, mo - 1, d, hh, mm, 0).toISOString()
}

function macrosFromHit(hit: FoodHit, s: number) {
  return {
    calories: String(Math.round(hit.macros.calories * s)),
    protein: String(round1(hit.macros.protein_g * s)),
    carbs: String(round1(hit.macros.carbs_g * s)),
    fat: String(round1(hit.macros.fat_g * s)),
  }
}

function microsFromHit(hit: FoodHit, s: number): Partial<Record<keyof Micros, string>> {
  if (!hit.micros) return {}
  const out: Partial<Record<keyof Micros, string>> = {}
  for (const { key } of MICROS_FIELDS) {
    const raw = (hit.micros as Record<string, number>)[key as string] ?? 0
    out[key] = String(round1(raw * s))
  }
  return out
}

export default function FoodEditSheet({ open, hit, date, initialMeal, onClose, onLogged }: Props) {
  const qc = useQueryClient()
  const today = toLocalISODate()
  const yesterday = (() => {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    return toLocalISODate(d)
  })()

  const initMeal = initialMeal ?? defaultMealForHour()

  const [servings, setServings] = useState(1)
  const [calories, setCalories] = useState('0')
  const [protein, setProtein] = useState('0')
  const [carbs, setCarbs] = useState('0')
  const [fat, setFat] = useState('0')
  const [macroOverridden, setMacroOverridden] = useState(false)
  const [microsState, setMicrosState] = useState<Partial<Record<keyof Micros, string>>>({})
  const [selectedDate, setSelectedDate] = useState<'today' | 'yesterday' | 'custom'>('today')
  const [customDate, setCustomDate] = useState(today)
  const [mealType, setMealType] = useState<MealType>(initMeal)
  const [timeStr, setTimeStr] = useState(() => mealDefaultTime(initMeal, today))
  const [timeOverridden, setTimeOverridden] = useState(false)
  const [saving, setSaving] = useState(false)
  const [microsOpen, setMicrosOpen] = useState(true)

  useEffect(() => {
    if (!hit) return
    const m = initialMeal ?? defaultMealForHour()
    const d = date
    setServings(1)
    const macs = macrosFromHit(hit, 1)
    setCalories(macs.calories)
    setProtein(macs.protein)
    setCarbs(macs.carbs)
    setFat(macs.fat)
    setMacroOverridden(false)
    setMicrosState(microsFromHit(hit, 1))
    setSelectedDate(d === today ? 'today' : d === yesterday ? 'yesterday' : 'custom')
    setCustomDate(d)
    setMealType(m)
    setTimeStr(mealDefaultTime(m, d))
    setTimeOverridden(false)
    setMicrosOpen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit])

  if (!open || !hit) return null

  const resolvedDate =
    selectedDate === 'today' ? today : selectedDate === 'yesterday' ? yesterday : customDate

  const handleMealChip = (meal: MealType) => {
    setMealType(meal)
    if (!timeOverridden) {
      setTimeStr(mealDefaultTime(meal, resolvedDate))
    }
  }

  const applyServings = (next: number) => {
    setServings(next)
    if (!macroOverridden && hit) {
      const macs = macrosFromHit(hit, next)
      setCalories(macs.calories)
      setProtein(macs.protein)
      setCarbs(macs.carbs)
      setFat(macs.fat)
      setMicrosState(microsFromHit(hit, next))
    }
  }

  const handleServingsStep = (delta: number) => {
    applyServings(Math.max(0.5, round1(servings + delta)))
  }

  const handleResetMacros = () => {
    if (!hit) return
    const macs = macrosFromHit(hit, servings)
    setCalories(macs.calories)
    setProtein(macs.protein)
    setCarbs(macs.carbs)
    setFat(macs.fat)
    setMicrosState(microsFromHit(hit, servings))
    setMacroOverridden(false)
  }

  const handleSave = async () => {
    if (!hit) return
    setSaving(true)
    try {
      const anyMicro = MICROS_FIELDS.some(({ key }) => Number(microsState[key] ?? 0) > 0)
      const micros: Micros | null = anyMicro
        ? (Object.fromEntries(
            MICROS_FIELDS.map(({ key }) => [key, Number(microsState[key] ?? 0)]),
          ) as unknown as Micros)
        : null

      const body: FoodLogCreate = {
        date: resolvedDate,
        name: hit.name,
        serving: hit.serving || '1 serving',
        macros: {
          calories: Number(calories),
          protein_g: Number(protein),
          carbs_g: Number(carbs),
          fat_g: Number(fat),
        } as Macros,
        source: 'manual',
        meal_type: mealType,
        logged_at: buildLoggedAt(resolvedDate, timeStr),
        ...(micros ? { micros } : {}),
        ...(hit.usda_fdc_id != null ? { usda_fdc_id: hit.usda_fdc_id } : {}),
      }

      await nutritionApi.logs.create(body)
      void qc.invalidateQueries({ queryKey: ['day-logs', resolvedDate] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Logged')
      onLogged()
    } catch {
      toast.error('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const badge = SOURCE_BADGE[hit.source?.toLowerCase() ?? '']
  const kcalNum = Math.round(Number(calories))
  const mealLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1)

  return (
    <div
      className="fixed inset-0 z-60 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
          {/* Title + badge */}
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-gray-900 leading-snug">{hit.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{hit.serving || '1 serving'}</p>
            </div>
            {badge && (
              <span
                className="px-2 py-0.5 rounded text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: badge.bg, color: badge.fg }}
              >
                {badge.label}
              </span>
            )}
          </div>

          {/* Totals band */}
          <div className="bg-gray-50 rounded-xl p-3 flex gap-2 mb-4">
            <div className="flex-1 flex flex-col items-center">
              <span className="text-2xl font-extrabold text-primary-600 tabular-nums">{kcalNum}</span>
              <span className="text-xs text-gray-400">kcal</span>
            </div>
            {[
              { label: 'protein g', val: protein },
              { label: 'carbs g', val: carbs },
              { label: 'fat g', val: fat },
            ].map(({ label, val }) => (
              <div key={label} className="flex-1 flex flex-col items-center">
                <span className="text-base font-bold text-gray-800 tabular-nums">{val}</span>
                <span className="text-xs text-gray-400">{label}</span>
              </div>
            ))}
          </div>

          {/* When */}
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">When</p>
          <div className="flex gap-2 mb-3 flex-wrap">
            {(['today', 'yesterday'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  selectedDate === d
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {d === 'today' ? 'Today' : 'Yesterday'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedDate('custom')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                selectedDate === 'custom'
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Custom
            </button>
            {selectedDate === 'custom' && (
              <input
                type="date"
                value={customDate}
                max={today}
                onChange={(e) => setCustomDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700"
              />
            )}
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold text-gray-500">Time</span>
            <input
              type="time"
              value={timeStr}
              onChange={(e) => { setTimeStr(e.target.value); setTimeOverridden(true) }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
            />
          </div>

          <div className="flex gap-2 mb-4 flex-wrap">
            {MEAL_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleMealChip(value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  mealType === value
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Servings */}
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Servings</p>
          <div className="flex gap-2 mb-3 flex-wrap">
            {SERVING_QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => applyServings(q)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  servings === q
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => handleServingsStep(-0.5)}
              className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-700 hover:bg-gray-200"
            >
              -
            </button>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={servings}
              onChange={(e) => {
                const n = parseFloat(e.target.value)
                if (Number.isFinite(n) && n > 0) applyServings(round1(n))
              }}
              className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-semibold"
            />
            <button
              type="button"
              onClick={() => handleServingsStep(0.5)}
              className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-700 hover:bg-gray-200"
            >
              +
            </button>
          </div>

          {/* Macros */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Macros</p>
            {macroOverridden && (
              <button
                type="button"
                onClick={handleResetMacros}
                className="text-xs text-primary-600 font-semibold"
              >
                Reset
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {([
              { label: 'Calories', val: calories, set: setCalories },
              { label: 'Protein g', val: protein, set: setProtein },
              { label: 'Carbs g', val: carbs, set: setCarbs },
              { label: 'Fat g', val: fat, set: setFat },
            ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
              <div key={label}>
                <label className="block text-xs text-gray-400 mb-1">{label}</label>
                <input
                  type="number"
                  min="0"
                  value={val}
                  onChange={(e) => { set(e.target.value); setMacroOverridden(true) }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-semibold"
                />
              </div>
            ))}
          </div>

          {/* Micros */}
          <button
            type="button"
            onClick={() => setMicrosOpen((v) => !v)}
            className="flex items-center justify-between w-full mb-2"
          >
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Micros</p>
            <span className="text-xs text-gray-400 font-semibold">{microsOpen ? 'Hide' : 'Show'}</span>
          </button>
          {microsOpen && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {MICROS_FIELDS.map(({ key, label, unit }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">{label} ({unit})</label>
                  <input
                    type="number"
                    min="0"
                    value={microsState[key] ?? '0'}
                    onChange={(e) => setMicrosState((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sticky CTA */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving...' : `Add to ${mealLabel} - ${kcalNum} kcal`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full mt-2 py-2 text-sm text-gray-500 font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
