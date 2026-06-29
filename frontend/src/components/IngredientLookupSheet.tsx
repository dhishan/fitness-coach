/**
 * IngredientLookupSheet (web) — modal with three tabs to fill an
 * ingredient row: Search (USDA), Barcode (paste / type the code), Label
 * photo (upload a Nutrition Facts photo).
 *
 * On a successful hit, calls onFill with a patch ready to apply to the
 * ingredient form.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Estimation, Favorite, FoodLog, Recipe, RecipeIngredient } from '@fitness/shared-types'
import { nutritionApi, uploadsApi, type IngredientHit } from '../services/api'
import { toLocalISODate } from '../lib/dates'

type Patch = Partial<RecipeIngredient>
type Tab = 'search' | 'barcode' | 'photo'

function round1(v: number | undefined): number {
  if (!v) return 0
  return Math.round(v * 10) / 10
}

function hitToPatch(hit: Estimation | IngredientHit): Patch {
  const macros = hit.macros ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const micros = (hit.micros ?? {}) as Record<string, number>
  return {
    name: hit.name,
    serving_label: hit.serving || '1 serving',
    servings_used: 1,
    calories_per_serving: round1(macros.calories),
    protein_g_per_serving: round1(macros.protein_g),
    carbs_g_per_serving: round1(macros.carbs_g),
    fat_g_per_serving: round1(macros.fat_g),
    fiber_g_per_serving: round1(micros.fiber_g ?? 0),
    sugar_g_per_serving: round1(micros.sugar_g ?? 0),
    sodium_mg_per_serving: round1(micros.sodium_mg ?? 0),
    potassium_mg_per_serving: round1(micros.potassium_mg ?? 0),
    calcium_mg_per_serving: round1(micros.calcium_mg ?? 0),
    iron_mg_per_serving: round1(micros.iron_mg ?? 0),
    vitamin_c_mg_per_serving: round1(micros.vitamin_c_mg ?? 0),
    vitamin_d_mcg_per_serving: round1(micros.vitamin_d_mcg ?? 0),
    saturated_fat_g_per_serving: round1(micros.saturated_fat_g ?? 0),
    cholesterol_mg_per_serving: round1(micros.cholesterol_mg ?? 0),
    usda_fdc_id: (hit as IngredientHit).usda_fdc_id ?? null,
  }
}

// ---------------------------------------------------------------------------
// "My foods" — favorites, saved recipes, and recent logs, mapped to a hit
// shape hitToPatch understands. Mirrors the Add-food screen converters.
// ---------------------------------------------------------------------------

type MyFoodKind = 'favorite' | 'recipe' | 'recent'
type MyFood = { key: string; kind: MyFoodKind; hit: IngredientHit }

function toIngredientHit(
  name: string,
  serving: string,
  macros: IngredientHit['macros'],
  micros: Record<string, number> | null | undefined,
): IngredientHit {
  return { name, serving, macros, micros: micros ?? undefined }
}

function favToMyFood(fav: Favorite): MyFood {
  return {
    key: `fav:${fav.id}`,
    kind: 'favorite',
    hit: toIngredientHit(fav.name, fav.serving || '1 serving', fav.macros, fav.micros as unknown as Record<string, number> | null),
  }
}

function recipeToMyFood(r: Recipe): MyFood {
  return {
    key: `recipe:${r.id}`,
    kind: 'recipe',
    hit: toIngredientHit(r.name, `1 serving (of ${r.yields_servings})`, r.per_serving_macros, r.per_serving_micros as unknown as Record<string, number> | null),
  }
}

// A logged entry stores servings-scaled macros and an "N× ..." serving label.
// hitToPatch treats a hit as the single-serving base, so un-scale first.
function logToMyFood(log: FoodLog): MyFood {
  const r1 = (v: number) => Math.round(v * 10) / 10
  const m = /^(\d+(?:\.\d+)?)×\s*(.*)$/.exec(log.serving || '')
  const div = m && parseFloat(m[1]) > 0 ? parseFloat(m[1]) : 1
  const lm = log.micros as unknown as Record<string, number> | null | undefined
  return {
    key: `recent:${log.id}`,
    kind: 'recent',
    hit: toIngredientHit(
      log.name,
      m ? m[2] : log.serving || '1 serving',
      {
        calories: Math.round(log.macros.calories / div),
        protein_g: r1(log.macros.protein_g / div),
        carbs_g: r1(log.macros.carbs_g / div),
        fat_g: r1(log.macros.fat_g / div),
      },
      lm
        ? (Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, r1((v || 0) / div)])) as Record<string, number>)
        : null,
    ),
  }
}

const MYFOOD_TAG: Record<MyFoodKind, { label: string; cls: string }> = {
  favorite: { label: 'Fav', cls: 'bg-red-50 text-red-600' },
  recipe: { label: 'Recipe', cls: 'bg-emerald-50 text-emerald-600' },
  recent: { label: 'Recent', cls: 'bg-orange-50 text-orange-600' },
}

export default function IngredientLookupSheet({
  open,
  onClose,
  onFill,
}: {
  open: boolean
  onClose: () => void
  onFill: (patch: Patch) => void
}) {
  const [tab, setTab] = useState<Tab>('search')
  if (!open) return null

  const apply = (p: Patch) => {
    onFill(p)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Fill ingredient</h2>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            Close
          </button>
        </div>

        <div className="flex gap-1 px-3 pt-3 pb-2 border-b border-gray-100">
          <TabBtn label="Search" active={tab === 'search'} onClick={() => setTab('search')} />
          <TabBtn label="Barcode" active={tab === 'barcode'} onClick={() => setTab('barcode')} />
          <TabBtn label="Label photo" active={tab === 'photo'} onClick={() => setTab('photo')} />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'search' && <SearchPane onPick={apply} />}
          {tab === 'barcode' && <BarcodePane onPick={apply} />}
          {tab === 'photo' && <PhotoPane onPick={apply} />}
        </div>
      </div>
    </div>
  )
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-md text-xs font-semibold transition ${
        active ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchPane({ onPick }: { onPick: (p: Patch) => void }) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [estimating, setEstimating] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const today = toLocalISODate()
  const { data: favorites = [] } = useQuery({ queryKey: ['favorites'], queryFn: () => nutritionApi.favorites.list() })
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: () => nutritionApi.recipes.list() })
  const { data: dayLogs } = useQuery({ queryKey: ['day-logs', today], queryFn: () => nutritionApi.logs.list(today) })
  const { data: hits = [], isFetching: loading } = useQuery({
    queryKey: ['food-search', debouncedQ],
    queryFn: () => nutritionApi.searchFoods(debouncedQ, 15),
    enabled: debouncedQ.length >= 2,
    staleTime: 5 * 60_000,
  })
  const searched = debouncedQ.length >= 2

  // "My foods": favorites + saved recipes + recent logs, filtered by the query
  // and deduped by name (recipe > favorite > recent). Mirrors the Add screen.
  const myFoods: MyFood[] = useMemo(() => {
    const query = q.trim().toLowerCase()
    const match = (name: string) => !query || name.toLowerCase().includes(query)
    const favs = favorites.filter((f) => match(f.name)).map(favToMyFood)
    const recs = recipes.filter((r) => match(r.name)).map(recipeToMyFood)
    const recent = [...(dayLogs?.items ?? [])]
      .reverse()
      .filter((l) => match(l.name) || (l.description ?? '').toLowerCase().includes(query))
      .map(logToMyFood)
    const seen = new Set<string>()
    const out: MyFood[] = []
    for (const mf of [...recs, ...favs, ...recent]) {
      const key = mf.hit.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(mf)
    }
    return out.slice(0, query ? 12 : 6)
  }, [favorites, recipes, dayLogs, q])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q])

  const runAI = async () => {
    const query = q.trim()
    if (!query) return
    setEstimating(true)
    try {
      const est = await nutritionApi.estimateText(query)
      onPick(hitToPatch(est))
    } catch {
      // surfaced inline by leaving the row; user can retry
    } finally {
      setEstimating(false)
    }
  }

  const aiRow = q.trim().length > 1 && (
    <button
      onClick={() => void runAI()}
      disabled={estimating}
      className="w-full text-left flex items-center gap-3 p-3 rounded-md bg-teal-50 border border-teal-100 hover:bg-teal-100/70 disabled:opacity-60"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-gray-900">
          {estimating ? 'Estimating…' : `Use AI to estimate "${q.trim()}"`}
        </div>
        <div className="text-xs text-gray-500">Best for home-cooked dishes or unlisted foods</div>
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2">
        <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" />
      </svg>
    </button>
  )

  const showNoResults = q.trim().length > 0 && !loading && hits.length === 0 && myFoods.length === 0

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. chicken breast, greek yogurt"
        className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />

      <div className="space-y-1 max-h-80 overflow-y-auto">
        {myFoods.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 pt-1">From your foods</div>
            {myFoods.map((mf) => {
              const tag = MYFOOD_TAG[mf.kind]
              return (
                <button
                  key={mf.key}
                  onClick={() => onPick(hitToPatch(mf.hit))}
                  className="w-full text-left py-2.5 px-1 flex items-center gap-3 hover:bg-gray-50 rounded"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-900 truncate">{mf.hit.name}</span>
                      <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${tag.cls}`}>{tag.label}</span>
                    </div>
                    <div className="text-xs text-gray-500 tabular-nums">
                      {mf.hit.serving} · {Math.round(mf.hit.macros.calories)} kcal · {round1(mf.hit.macros.protein_g)}g P
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )
            })}
          </>
        )}

        {loading && <p className="text-sm text-gray-400 text-center py-4">Searching…</p>}

        {hits.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 pt-2">Results</div>
            {hits.map((h, i) => (
              <button
                key={i}
                onClick={() => onPick(hitToPatch(h))}
                className="w-full text-left py-2.5 px-1 flex items-center gap-3 hover:bg-gray-50 rounded"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{h.name}</div>
                  <div className="text-xs text-gray-500 tabular-nums">
                    {h.serving} · {Math.round(h.macros.calories)} kcal · {round1(h.macros.protein_g)}g P
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </>
        )}

        {showNoResults && (
          <p className="text-sm text-gray-400 text-center pt-2">No matches in our food databases.</p>
        )}

        {searched && aiRow}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barcode (text input on web — no native scanner)
// ---------------------------------------------------------------------------

function BarcodePane({ onPick }: { onPick: (p: Patch) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const clean = code.replace(/\D/g, '')
    if (clean.length < 8 || clean.length > 14) {
      setErr('Enter a valid 8–14 digit barcode')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const hit = await nutritionApi.barcode(clean)
      onPick(hitToPatch(hit as Estimation))
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        setErr("We don't recognize that barcode. Try Photo or Search.")
      } else {
        setErr('Lookup failed. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Type or paste the UPC/EAN digits from the package. We check Open Food Facts then USDA.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="0 41570 05181 8"
          className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 tabular-nums"
        />
        <button
          onClick={() => void run()}
          disabled={busy}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Look up'}
        </button>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Label photo
// ---------------------------------------------------------------------------

function PhotoPane({ onPick }: { onPick: (p: Patch) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setBusy(true)
    setErr(null)
    try {
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')
      const put = await fetch(signed.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: file,
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status})`)
      const est = await nutritionApi.estimateLabel(signed.public_url)
      onPick(hitToPatch(est))
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (e as Error)?.message ??
        'Try again.'
      setErr(String(detail))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Upload a clear photo of the Nutrition Facts panel. We read per-serving values as printed.
      </p>
      <label className="block">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
        <span
          className={`block w-full text-center py-3 rounded-md text-sm font-bold cursor-pointer ${
            busy
              ? 'bg-blue-300 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {busy ? 'Reading…' : 'Choose photo'}
        </span>
      </label>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  )
}
