/**
 * Recipe editor. /recipes/new for create, /recipes/:id for edit.
 *
 * Ingredients are entered straight off the label (per single serving) with a
 * separate `servings_used` multiplier. Math mirrors the backend exactly.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RecipeIngredient } from '@fitness/shared-types'
import { nutritionApi } from '../services/api'
import IngredientLookupSheet from '../components/IngredientLookupSheet'

type IngredientForm = RecipeIngredient & { _key: string }

function emptyIngredient(): IngredientForm {
  return {
    _key: Math.random().toString(36).slice(2),
    name: '',
    serving_label: '1 serving',
    servings_used: 1,
    calories_per_serving: 0,
    protein_g_per_serving: 0,
    carbs_g_per_serving: 0,
    fat_g_per_serving: 0,
  }
}

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function computeLocalTotals(ings: IngredientForm[], yields: number) {
  const t = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  for (const i of ings) {
    const u = i.servings_used || 0
    if (u <= 0) continue
    t.calories += (i.calories_per_serving || 0) * u
    t.protein_g += (i.protein_g_per_serving || 0) * u
    t.carbs_g += (i.carbs_g_per_serving || 0) * u
    t.fat_g += (i.fat_g_per_serving || 0) * u
  }
  const safe = yields > 0 ? yields : 1
  return {
    total: {
      calories: Math.round(t.calories),
      protein_g: round1(t.protein_g),
      carbs_g: round1(t.carbs_g),
      fat_g: round1(t.fat_g),
    },
    per: {
      calories: Math.round(t.calories / safe),
      protein_g: round1(t.protein_g / safe),
      carbs_g: round1(t.carbs_g / safe),
      fat_g: round1(t.fat_g / safe),
    },
  }
}

export default function RecipeEditor() {
  const { id = 'new' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = id === 'new'

  const { data: existing, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => nutritionApi.recipes.get(id),
    enabled: !isNew,
  })

  const [name, setName] = useState('')
  const [yields, setYields] = useState('1')
  const [notes, setNotes] = useState('')
  const [ingredients, setIngredients] = useState<IngredientForm[]>([emptyIngredient()])

  useEffect(() => {
    if (existing && !isNew) {
      setName(existing.name)
      setYields(String(existing.yields_servings))
      setNotes(existing.notes ?? '')
      setIngredients(
        existing.ingredients.map((i) => ({
          ...i,
          _key: Math.random().toString(36).slice(2),
        })),
      )
    }
  }, [existing, isNew])

  const yieldsNum = Math.max(0.0001, parseFloat(yields) || 1)
  const totals = computeLocalTotals(ingredients, yieldsNum)

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        yields_servings: yieldsNum,
        ingredients: ingredients
          .filter((i) => i.name.trim() && i.servings_used > 0)
          .map(({ _key: _, ...rest }) => rest),
        notes: notes.trim(),
      }
      if (isNew) return nutritionApi.recipes.create(body)
      return nutritionApi.recipes.update(id, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipes'] })
      void qc.invalidateQueries({ queryKey: ['recipe', id] })
      navigate('/recipes')
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => nutritionApi.recipes.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipes'] })
      navigate('/recipes')
    },
  })

  const canSave =
    name.trim().length > 0 &&
    yieldsNum > 0 &&
    ingredients.some((i) => i.name.trim() && i.servings_used > 0)

  const handleDelete = () => {
    if (!confirm(`Delete "${name}"?`)) return
    deleteMut.mutate()
  }

  const updateIng = (key: string, patch: Partial<IngredientForm>) => {
    setIngredients((prev) => prev.map((i) => (i._key === key ? { ...i, ...patch } : i)))
  }

  if (!isNew && isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading…</div>
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/recipes')}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-gray-900">
            {isNew ? 'New recipe' : 'Edit recipe'}
          </h1>
        </div>
        <button
          onClick={() => saveMut.mutate()}
          disabled={!canSave || saveMut.isPending}
          className="text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40"
        >
          {saveMut.isPending ? '…' : 'Save'}
        </button>
      </div>

      <div className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Berry Shake"
              className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Yields (servings)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={yields}
              onChange={(e) => setYields(e.target.value)}
              className="mt-1 w-32 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gray-100 rounded-xl border border-gray-200 p-4">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Per serving
          </div>
          <div className="flex justify-around mt-2">
            <Stat val={String(totals.per.calories)} label="kcal" />
            <Stat val={`${fmt(totals.per.protein_g)}g`} label="protein" />
            <Stat val={`${fmt(totals.per.carbs_g)}g`} label="carbs" />
            <Stat val={`${fmt(totals.per.fat_g)}g`} label="fat" />
          </div>
          <div className="text-[11px] text-gray-500 text-center mt-2 tabular-nums">
            Total: {totals.total.calories} kcal · {fmt(totals.total.protein_g)}g P ·{' '}
            {fmt(totals.total.carbs_g)}g C · {fmt(totals.total.fat_g)}g F
          </div>
        </div>

        {/* Ingredients */}
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
          Ingredients
        </div>
        {ingredients.map((ing, idx) => (
          <IngredientCard
            key={ing._key}
            index={idx}
            ingredient={ing}
            onChange={(patch) => updateIng(ing._key, patch)}
            onRemove={
              ingredients.length > 1
                ? () =>
                    setIngredients((prev) => prev.filter((i) => i._key !== ing._key))
                : undefined
            }
          />
        ))}
        <button
          onClick={() => setIngredients((prev) => [...prev, emptyIngredient()])}
          className="w-full border-2 border-dashed border-blue-300 rounded-xl py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50"
        >
          + Add ingredient
        </button>

        {!isNew && (
          <button
            onClick={handleDelete}
            className="block mx-auto mt-6 text-sm font-semibold text-red-500 hover:text-red-600"
          >
            Delete recipe
          </button>
        )}
      </div>
    </div>
  )
}

function Stat({ val, label }: { val: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-gray-900 tabular-nums">{val}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  )
}

function IngredientCard({
  index,
  ingredient,
  onChange,
  onRemove,
}: {
  index: number
  ingredient: IngredientForm
  onChange: (patch: Partial<IngredientForm>) => void
  onRemove?: () => void
}) {
  const [showMicros, setShowMicros] = useState(false)
  const [lookupOpen, setLookupOpen] = useState(false)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
          Ingredient {index + 1}
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-xs font-semibold text-red-500 hover:text-red-600"
          >
            Remove
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setLookupOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-md bg-blue-50 border border-blue-200 text-blue-600 text-sm font-semibold hover:bg-blue-100"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 5.8L20 10l-5.1 3.7L17 20l-5-3.5L7 20l2.1-6.3L4 10l6.1-1.2L12 3z" />
        </svg>
        <span>Auto-fill from barcode, label, or search</span>
      </button>

      <IngredientLookupSheet
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onFill={(patch) => onChange(patch)}
      />

      <Input
        label="Name"
        value={ingredient.name}
        onChange={(v) => onChange({ name: v })}
        placeholder="e.g. Ascent Whey"
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label="Serving size"
            value={ingredient.serving_label}
            onChange={(v) => onChange({ serving_label: v })}
            placeholder="1 scoop (31g)"
          />
        </div>
        <div className="w-28">
          <Input
            label="How many?"
            value={String(ingredient.servings_used)}
            onChange={(v) => onChange({ servings_used: parseFloat(v) || 0 })}
            inputMode="decimal"
          />
        </div>
      </div>

      <div className="text-[11px] text-gray-500">Per single serving (from the label)</div>
      <div className="grid grid-cols-4 gap-2">
        <NumInput label="Calories" value={ingredient.calories_per_serving} onChange={(v) => onChange({ calories_per_serving: v })} />
        <NumInput label="Protein g" value={ingredient.protein_g_per_serving} onChange={(v) => onChange({ protein_g_per_serving: v })} />
        <NumInput label="Carbs g" value={ingredient.carbs_g_per_serving} onChange={(v) => onChange({ carbs_g_per_serving: v })} />
        <NumInput label="Fat g" value={ingredient.fat_g_per_serving} onChange={(v) => onChange({ fat_g_per_serving: v })} />
      </div>

      <button
        type="button"
        onClick={() => setShowMicros((v) => !v)}
        className="text-xs font-semibold text-blue-600 hover:text-blue-700"
      >
        {showMicros ? '▾ Hide micros' : '▸ More nutrients (optional)'}
      </button>
      {showMicros && (
        <div className="grid grid-cols-4 gap-2">
          <NumInput label="Fiber g" value={ingredient.fiber_g_per_serving ?? 0} onChange={(v) => onChange({ fiber_g_per_serving: v })} />
          <NumInput label="Sugar g" value={ingredient.sugar_g_per_serving ?? 0} onChange={(v) => onChange({ sugar_g_per_serving: v })} />
          <NumInput label="Sat fat g" value={ingredient.saturated_fat_g_per_serving ?? 0} onChange={(v) => onChange({ saturated_fat_g_per_serving: v })} />
          <NumInput label="Chol mg" value={ingredient.cholesterol_mg_per_serving ?? 0} onChange={(v) => onChange({ cholesterol_mg_per_serving: v })} />
          <NumInput label="Sodium mg" value={ingredient.sodium_mg_per_serving ?? 0} onChange={(v) => onChange({ sodium_mg_per_serving: v })} />
          <NumInput label="Potassium mg" value={ingredient.potassium_mg_per_serving ?? 0} onChange={(v) => onChange({ potassium_mg_per_serving: v })} />
          <NumInput label="Calcium mg" value={ingredient.calcium_mg_per_serving ?? 0} onChange={(v) => onChange({ calcium_mg_per_serving: v })} />
          <NumInput label="Iron mg" value={ingredient.iron_mg_per_serving ?? 0} onChange={(v) => onChange({ iron_mg_per_serving: v })} />
          <NumInput label="Vit C mg" value={ingredient.vitamin_c_mg_per_serving ?? 0} onChange={(v) => onChange({ vitamin_c_mg_per_serving: v })} />
          <NumInput label="Vit D mcg" value={ingredient.vitamin_d_mcg_per_serving ?? 0} onChange={(v) => onChange({ vitamin_d_mcg_per_serving: v })} />
        </div>
      )}
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="mt-1 w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  )
}

function NumInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={value === 0 ? '' : String(value)}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        placeholder="0"
        className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1 text-sm text-center outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  )
}
