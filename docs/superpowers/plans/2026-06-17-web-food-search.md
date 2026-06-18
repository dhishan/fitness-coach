# Web Food Search Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web equivalent of the mobile food-search feature: a full-screen AddFood search modal backed by USDA/OFF/IFCT search, a FoodEditSheet for editing macros/micros and logging, and a simplified "+ Add food" CTA in Nutrition.tsx.

**Architecture:** `FoodEditSheet.tsx` already exists as an untracked file (fully built). `AddFood.tsx` is a new page component rendered as a modal overlay over Nutrition. `Nutrition.tsx` keeps its existing camera/barcode/recipe shortcuts but replaces the large inline composer with a single "+ Add food" button that sets `addFoodOpen=true`. No new route needed - state toggle in Nutrition.tsx.

**Tech Stack:** React 18, React Query v5, TypeScript strict, Tailwind CSS, `@fitness/shared-types`, existing `nutritionApi` and `IngredientHit` from `api.ts`.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/services/api.ts` | Modify | Add `source?: 'usda' \| 'off' \| 'ifct'` to `IngredientHit` |
| `frontend/src/components/FoodEditSheet.tsx` | Stage (already exists untracked) | Modal edit sheet - already built |
| `frontend/src/pages/AddFood.tsx` | Create | Full-screen search: history, search results, AI fallback |
| `frontend/src/pages/Nutrition.tsx` | Modify | Replace inline composer with "+ Add food" CTA + keep shortcuts |

---

## Task 1: Add `source` field to `IngredientHit`

**Files:**
- Modify: `frontend/src/services/api.ts` lines 17-24

- [ ] **Step 1: Edit `IngredientHit` interface**

In `/Users/dhishan/Projects/fitness-tracker/frontend/src/services/api.ts`, change:
```ts
export interface IngredientHit {
  name: string
  serving: string
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  micros?: Record<string, number>
  usda_fdc_id?: number | null
  data_type?: string
}
```
to:
```ts
export interface IngredientHit {
  name: string
  serving: string
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  micros?: Record<string, number>
  usda_fdc_id?: number | null
  data_type?: string
  source?: 'usda' | 'off' | 'ifct' | string | null
}
```

- [ ] **Step 2: Stage FoodEditSheet.tsx (already exists as untracked)**

```bash
git add frontend/src/components/FoodEditSheet.tsx
```

- [ ] **Step 3: Verify tsc still clean**

```bash
cd /Users/dhishan/Projects/fitness-tracker/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/dhishan/Projects/fitness-tracker && git add frontend/src/services/api.ts frontend/src/components/FoodEditSheet.tsx
git commit -m "$(cat <<'EOF'
feat(web/nutrition): add FoodEditSheet + source field to IngredientHit

FoodEditSheet provides the When/Servings/Macros/Micros edit modal with a
sticky Add CTA. IngredientHit gains source for badge rendering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `AddFood.tsx`

**Files:**
- Create: `frontend/src/pages/AddFood.tsx`

This is a full-screen overlay (fixed inset-0 z-50) with:
- Header: back arrow + "Add food" title + meal chip row
- Search input with barcode paste icon + photo upload icon
- 300ms debounced search via `nutritionApi.searchFoods`
- Empty state (no query): "From your history" section showing recent logs (last 5 from day-logs) + favorites + recipes
- Results section: merged list from searchFoods, source badge per row
- AI fallback row at bottom: "Use AI to estimate <q>" via `nutritionApi.estimateText`
- Clicking any row opens `FoodEditSheet`

- [ ] **Step 1: Write `AddFood.tsx`**

Create `/Users/dhishan/Projects/fitness-tracker/frontend/src/pages/AddFood.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MealType } from '@fitness/shared-types'
import { nutritionApi, uploadsApi, type IngredientHit } from '../services/api'
import FoodEditSheet, { type FoodHit } from '../components/FoodEditSheet'
import { toLocalISODate } from '../lib/dates'

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
      // silently ignore; user can retry
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
      // silently ignore
    }
  }

  const handleBarcodeChange = async (raw: string) => {
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
      // silently ignore; user will see no sheet open
    }
  }

  const recentLogs = (dayLogs?.logs ?? []).slice(0, 5)
  const hasResults = debouncedQ.length >= 2

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
            {/* Barcode icon: triggers numeric paste input */}
            <label className="flex-shrink-0 cursor-pointer">
              <input
                type="text"
                inputMode="numeric"
                className="sr-only"
                onChange={(e) => void handleBarcodeChange(e.target.value)}
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 hover:text-gray-600">
                <path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v14" />
              </svg>
            </label>
            {/* Photo upload icon */}
            <label className="flex-shrink-0 cursor-pointer">
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

        {/* Scrollable results */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {!hasResults && (
            <>
              {recentLogs.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Recent today</p>
                  {recentLogs.map((log) => (
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
                        <p className="text-xs text-gray-400 tabular-nums">{log.serving} - {Math.round(log.macros.calories)} kcal</p>
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
                        micros: fav.micros as Record<string, number> | undefined,
                        source: 'favorite',
                      })}
                      className="w-full text-left flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{fav.name}</p>
                        <p className="text-xs text-gray-400 tabular-nums">{fav.serving} - {Math.round(fav.macros.calories)} kcal</p>
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
                    const totalKcal = rec.ingredients.reduce((s, ing) => s + ing.calories_per_serving * ing.servings_used, 0)
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => openEditWithHit({
                          name: rec.name,
                          serving: `${rec.servings} serving${rec.servings !== 1 ? 's' : ''}`,
                          macros: {
                            calories: totalKcal,
                            protein_g: rec.ingredients.reduce((s, i) => s + i.protein_g_per_serving * i.servings_used, 0),
                            carbs_g: rec.ingredients.reduce((s, i) => s + i.carbs_g_per_serving * i.servings_used, 0),
                            fat_g: rec.ingredients.reduce((s, i) => s + i.fat_g_per_serving * i.servings_used, 0),
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

          {hasResults && (
            <section>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Results</p>
              {searchResults.length === 0 && !searching && (
                <p className="text-sm text-gray-400 py-4 text-center">No matches. Try a different term or use AI below.</p>
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

              {/* AI fallback */}
              {debouncedQ.length >= 2 && (
                <button
                  type="button"
                  disabled={estimating}
                  onClick={() => void handleAIEstimate()}
                  className="mt-3 w-full py-3 rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 font-medium hover:bg-gray-50 disabled:opacity-60"
                >
                  {estimating ? 'Estimating...' : `Use AI to estimate "${debouncedQ}"`}
                </button>
              )}
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
```

- [ ] **Step 2: Verify tsc is clean**

```bash
cd /Users/dhishan/Projects/fitness-tracker/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

---

## Task 3: Simplify `Nutrition.tsx` composer - add "+ Add food" CTA

**Files:**
- Modify: `frontend/src/pages/Nutrition.tsx`

The composer section (lines ~907-1141) currently has 5 sub-modes: idle, text, barcode, recipe, favorites. We replace the idle mode's button grid with a primary "+ Add food" button plus camera, barcode, recipe icon shortcuts. The text and favorites sub-modes can be removed since AddFood covers them. The barcode and recipe sub-modes stay for their existing flows.

- [ ] **Step 1: Add state import and AddFood import at top of Nutrition.tsx**

After the existing imports add:
```tsx
import AddFood from './AddFood'
```

- [ ] **Step 2: Add `addFoodOpen` state inside the Nutrition component**

After existing `useState` declarations, add:
```tsx
const [addFoodOpen, setAddFoodOpen] = useState(false)
```

- [ ] **Step 3: Replace the idle composer buttons grid**

Find and replace the idle composer section (the `composer === 'idle'` block) to just show "+ Add food" + camera/barcode/recipe icons:
```tsx
{composer === 'idle' && (
  <div className="flex flex-col gap-3">
    <button
      onClick={() => setAddFoodOpen(true)}
      className="w-full py-3 rounded-xl bg-primary-500 text-white text-sm font-bold hover:bg-primary-600 transition-colors"
    >
      + Add food
    </button>
    <div className="flex gap-2">
      <button
        onClick={() => photoInputRef.current?.click()}
        className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>Camera</span>
      </button>
      <button
        onClick={() => { setComposer('barcode'); setBarcodeInput(''); setBarcodeError(null) }}
        className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v14"/></svg>
        <span>Barcode</span>
      </button>
      <button
        onClick={() => setComposer('recipe')}
        className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 font-medium hover:bg-gray-50 flex flex-col items-center gap-1"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 21v-3a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v3"/><circle cx="12" cy="7" r="4"/></svg>
        <span>Recipe</span>
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Remove the `composer === 'text'` and `composer === 'favorites'` blocks**

These are no longer reachable (no button sets composer to 'text' or 'favorites'). Remove both blocks to keep the file clean. The barcode and recipe blocks stay unchanged.

Also remove the `'text' | 'favorites'` literals from the `composer` state type. Change:
```tsx
const [composer, setComposer] = useState<'idle' | 'text' | 'barcode' | 'recipe' | 'favorites'>('idle')
```
to:
```tsx
const [composer, setComposer] = useState<'idle' | 'barcode' | 'recipe'>('idle')
```

Remove any state variables only used by the text composer: `textInput`, `setTextInput`, `suggestQ`, `setSuggestQ`, `highlightIdx`, `setHighlightIdx`, `foodSuggestions`, `debounceRef` (if only used for text autocomplete). Check usage before removing.

- [ ] **Step 5: Add `<AddFood>` render at the bottom of the Nutrition return (before closing tag)**

```tsx
<AddFood
  open={addFoodOpen}
  date={date}
  initialMeal={defaultMealType()}
  onClose={() => setAddFoodOpen(false)}
  onLogged={() => {
    setAddFoodOpen(false)
    void qc.invalidateQueries({ queryKey: ['day-logs', date] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }}
/>
```

- [ ] **Step 6: Verify tsc is clean**

```bash
cd /Users/dhishan/Projects/fitness-tracker/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 7: Run build**

```bash
cd /Users/dhishan/Projects/fitness-tracker/frontend && npm run build 2>&1 | tail -20
```

Expected: `built in X.Xs` with no errors.

- [ ] **Step 8: Commit everything**

```bash
cd /Users/dhishan/Projects/fitness-tracker && git add frontend/src/pages/AddFood.tsx frontend/src/pages/Nutrition.tsx
git commit -m "$(cat <<'EOF'
feat(web/nutrition): add full-screen food search modal + simplify composer

AddFood.tsx provides debounced USDA/OFF/IFCT search, recent/favorites/recipes
empty state, AI text estimation fallback, barcode/photo shortcuts, and hands
off to FoodEditSheet for the edit-and-log flow.

Nutrition.tsx composer simplified to a single '+ Add food' CTA with camera,
barcode, recipe shortcuts - removing the inline text + favorites sub-modes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**
- [x] `source` field on `IngredientHit` - Task 1
- [x] `FoodEditSheet.tsx` - already exists; Task 1 stages it
- [x] Title + source badge - in FoodEditSheet (already built)
- [x] Live macro totals band - in FoodEditSheet
- [x] When (date + time + meal chips + auto-fill) - in FoodEditSheet
- [x] Servings chips + +/- - in FoodEditSheet
- [x] Macros 4 inputs + Reset - in FoodEditSheet
- [x] Micros 10 inputs collapsible - in FoodEditSheet
- [x] Sticky Add CTA - in FoodEditSheet
- [x] AddFood full-screen modal - Task 2
- [x] Search + barcode paste + photo upload icons - Task 2
- [x] Meal chip row with auto-pick - Task 2
- [x] From your history: recent + recipes + favorites - Task 2
- [x] Results: merged list from searchFoods - Task 2
- [x] AI fallback row - Task 2
- [x] 300ms debounce - Task 2
- [x] Empty state (no query): Recent + Favorites + Recipes - Task 2
- [x] Nutrition.tsx "+ Add food" CTA - Task 3
- [x] Cache invalidation on save - in FoodEditSheet + AddFood onLogged
- [x] Source badge colors - SOURCE_BADGE constants match spec exactly

**Placeholder scan:** No TBDs or placeholder patterns found.

**Type consistency:**
- `FoodHit` is imported from `FoodEditSheet` in AddFood - consistent
- `IngredientHit` from api.ts used directly in AddFood search results - consistent
- `source` field added as `string | null` to IngredientHit (superset of 'usda'|'off'|'ifct') - safe for badge lookup via toLowerCase()
