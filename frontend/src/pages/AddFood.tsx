import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FoodLog, MealType } from '@fitness/shared-types'
import { nutritionApi, uploadsApi } from '../services/api'
import FoodEditSheet, { type FoodHit } from '../components/FoodEditSheet'

interface Props {
  open: boolean
  date: string
  initialMeal?: MealType
  onClose: () => void
  onLogged: () => void
}

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  ifct:     { bg: '#fef3c7', fg: '#b45309', label: 'IFCT' },
  usda:     { bg: '#dbeafe', fg: '#2563eb', label: 'USDA' },
  off:      { bg: '#ede9fe', fg: '#7c3aed', label: 'OFF' },
  recent:   { bg: '#fff7ed', fg: '#ea580c', label: 'Recent' },
  recipe:   { bg: '#ecfdf5', fg: '#16a34a', label: 'Recipe' },
  favorite: { bg: '#fef2f2', fg: '#dc2626', label: 'Favorite' },
}

const MEAL_OPTIONS: { label: string; value: MealType }[] = [
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Lunch',     value: 'lunch'     },
  { label: 'Dinner',    value: 'dinner'    },
  { label: 'Snack',     value: 'snack'     },
]

function defaultMealForHour(): MealType {
  const h = new Date().getHours()
  if (h >= 4 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 15 && h < 18) return 'snack'
  return 'dinner'
}

function SourceBadge({ source }: { source?: string | null }) {
  const s = source?.toLowerCase() ?? ''
  const b = SOURCE_BADGE[s]
  if (!b) return null
  return (
    <span
      className="px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0"
      style={{ backgroundColor: b.bg, color: b.fg }}
    >
      {b.label}
    </span>
  )
}

export default function AddFood({ open, date, initialMeal, onClose, onLogged }: Props) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [meal, setMeal] = useState<MealType>(initialMeal ?? defaultMealForHour())
  const [editHit, setEditHit] = useState<FoodHit | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setDebouncedQ('')
      setMeal(initialMeal ?? defaultMealForHour())
    }
  }, [open, initialMeal])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q])

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['food-search', debouncedQ],
    queryFn: () => nutritionApi.searchFoods(debouncedQ, 12),
    enabled: debouncedQ.length >= 2,
    staleTime: 60_000,
  })

  const { data: dayLogs } = useQuery({
    queryKey: ['day-logs', date],
    queryFn: () => nutritionApi.logs.list(date),
    enabled: open,
  })

  const { data: favorites = [] } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => nutritionApi.favorites.list(),
    enabled: open,
    staleTime: 120_000,
  })

  const { data: recipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
    enabled: open,
    staleTime: 120_000,
  })

  if (!open) return null

  const openEditWithHit = (hit: FoodHit) => {
    setEditHit(hit)
    setEditOpen(true)
  }

  const handleAIEstimate = async () => {
    if (!q.trim()) return
    setEstimating(true)
    try {
      const est = await nutritionApi.estimateText(q.trim())
      openEditWithHit({
        name: est.name,
        serving: est.serving,
        macros: est.macros,
        micros: est.micros as Record<string, number> | undefined,
        source: 'ai',
      })
    } catch {
      // user sees no sheet; they can retry
    } finally {
      setEstimating(false)
    }
  }

  const handlePhotoUpload = async (file: File) => {
    try {
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')
      const put = await fetch(signed.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: file,
      })
      if (!put.ok) return
      const est = await nutritionApi.estimateLabel(signed.public_url)
      openEditWithHit({
        name: est.name,
        serving: est.serving,
        macros: est.macros,
        micros: est.micros as Record<string, number> | undefined,
        source: 'ai',
      })
    } catch {
      // silently ignore; no sheet opens
    }
  }

  const handleBarcodeInput = async (raw: string) => {
    const code = raw.replace(/\D/g, '')
    if (code.length < 8 || code.length > 14) return
    try {
      const hit = await nutritionApi.barcode(code)
      openEditWithHit({
        name: hit.name,
        serving: hit.serving,
        macros: hit.macros,
        micros: hit.micros as Record<string, number> | undefined,
        source: hit.source ?? 'off',
      })
    } catch {
      // silently ignore
    }
  }

  const recentLogs = (dayLogs?.items ?? []).slice(0, 5)
  const hasQuery = debouncedQ.length >= 2

  return (
    <>
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-gray-900 flex-1">Add food</h1>
        </div>

        {/* Meal chips */}
        <div className="flex gap-2 px-4 py-2.5 border-b border-gray-100 overflow-x-auto">
          {MEAL_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMeal(value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex-shrink-0 transition-colors ${
                meal === value
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search foods, e.g. chicken breast"
              className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-400"
            />
            {searching && (
              <div className="w-4 h-4 rounded-full border-2 border-primary-400 border-t-transparent animate-spin flex-shrink-0" />
            )}
            {/* Barcode: hidden numeric input triggered by icon */}
            <label className="flex-shrink-0 cursor-pointer" title="Enter barcode">
              <input
                type="text"
                inputMode="numeric"
                className="sr-only"
                onChange={(e) => void handleBarcodeInput(e.target.value)}
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 hover:text-gray-600">
                <path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v14" />
              </svg>
            </label>
            {/* Photo upload */}
            <label className="flex-shrink-0 cursor-pointer" title="Upload nutrition label">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handlePhotoUpload(f)
                }}
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 hover:text-gray-600">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
              </svg>
            </label>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {!hasQuery && (
            <>
              {recentLogs.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Recent today</p>
                  {recentLogs.map((log: FoodLog) => (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => openEditWithHit({
                        name: log.name,
                        serving: log.serving,
                        macros: log.macros,
                        micros: log.micros as Record<string, number> | undefined,
                        source: 'recent',
                      })}
                      className="w-full text-left flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{log.name}</p>
                        <p className="text-xs text-gray-400 tabular-nums">
                          {log.serving} - {Math.round(log.macros.calories)} kcal
                        </p>
                      </div>
                      <SourceBadge source="recent" />
                    </button>
                  ))}
                </section>
              )}

              {favorites.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Favorites</p>
                  {favorites.slice(0, 5).map((fav) => (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => openEditWithHit({
                        name: fav.name,
                        serving: fav.serving,
                        macros: fav.macros,
                        source: 'favorite',
                      })}
                      className="w-full text-left flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{fav.name}</p>
                        <p className="text-xs text-gray-400 tabular-nums">
                          {fav.serving} - {Math.round(fav.macros.calories)} kcal
                        </p>
                      </div>
                      <SourceBadge source="favorite" />
                    </button>
                  ))}
                </section>
              )}

              {recipes.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Recipes</p>
                  {recipes.slice(0, 5).map((rec) => {
                    const totalKcal = rec.ingredients.reduce(
                      (s, ing) => s + (ing.calories_per_serving || 0) * (ing.servings_used || 1),
                      0,
                    )
                    const totalProtein = rec.ingredients.reduce(
                      (s, ing) => s + (ing.protein_g_per_serving || 0) * (ing.servings_used || 1),
                      0,
                    )
                    const totalCarbs = rec.ingredients.reduce(
                      (s, ing) => s + (ing.carbs_g_per_serving || 0) * (ing.servings_used || 1),
                      0,
                    )
                    const totalFat = rec.ingredients.reduce(
                      (s, ing) => s + (ing.fat_g_per_serving || 0) * (ing.servings_used || 1),
                      0,
                    )
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => openEditWithHit({
                          name: rec.name,
                          serving: `${rec.yields_servings} serving${rec.yields_servings !== 1 ? 's' : ''}`,
                          macros: {
                            calories: totalKcal,
                            protein_g: totalProtein,
                            carbs_g: totalCarbs,
                            fat_g: totalFat,
                          },
                          source: 'recipe',
                        })}
                        className="w-full text-left flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{rec.name}</p>
                          <p className="text-xs text-gray-400 tabular-nums">{Math.round(totalKcal)} kcal</p>
                        </div>
                        <SourceBadge source="recipe" />
                      </button>
                    )
                  })}
                </section>
              )}

              {recentLogs.length === 0 && favorites.length === 0 && recipes.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">
                  Start typing to search 900k+ foods.
                </p>
              )}
            </>
          )}

          {hasQuery && (
            <section>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Results</p>
              {searchResults.length === 0 && !searching && (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No matches. Try a different term or use AI below.
                </p>
              )}
              {searchResults.map((hit, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openEditWithHit({
                    name: hit.name,
                    serving: hit.serving,
                    macros: hit.macros,
                    micros: hit.micros,
                    source: hit.source ?? null,
                    usda_fdc_id: hit.usda_fdc_id,
                  })}
                  className="w-full text-left flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{hit.name}</p>
                    <p className="text-xs text-gray-400 tabular-nums">
                      {hit.serving} - {Math.round(hit.macros.calories)} kcal | P {hit.macros.protein_g.toFixed(1)}g
                    </p>
                  </div>
                  <SourceBadge source={hit.source} />
                </button>
              ))}

              <button
                type="button"
                disabled={estimating}
                onClick={() => void handleAIEstimate()}
                className="mt-3 w-full py-3 rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 font-medium hover:bg-gray-50 disabled:opacity-60"
              >
                {estimating ? 'Estimating...' : `Use AI to estimate "${debouncedQ}"`}
              </button>
            </section>
          )}
        </div>
      </div>

      <FoodEditSheet
        open={editOpen}
        hit={editHit}
        date={date}
        initialMeal={meal}
        onClose={() => setEditOpen(false)}
        onLogged={() => {
          setEditOpen(false)
          onLogged()
        }}
      />
    </>
  )
}
