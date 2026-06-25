/**
 * Saved foods — unified library of saved foods (favorites) and recipes.
 * Recipes open the recipe editor; foods edit inline. "+ New" creates either.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Favorite, Macros, Recipe } from '@fitness/shared-types'
import { nutritionApi } from '../services/api'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export default function Recipes() {
  const navigate = useNavigate()
  const [editFav, setEditFav] = useState<Favorite | null>(null)
  const [newFav, setNewFav] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: recipes = [], isLoading: lr } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
  })
  const { data: favorites = [], isLoading: lf } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => nutritionApi.favorites.list(),
  })

  const isLoading = lr || lf
  const empty = recipes.length === 0 && favorites.length === 0

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <h1 className="text-lg font-bold text-gray-900">Saved foods</h1>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            + New
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-100 z-10">
              <button
                onClick={() => { setMenuOpen(false); setNewFav(true) }}
                className="block w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50"
              >
                Food (single item)
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate('/recipes/new') }}
                className="block w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-t border-gray-100"
              >
                Recipe (from ingredients)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-4">
        {isLoading ? (
          <div className="text-center text-gray-400 mt-8">Loading…</div>
        ) : empty ? (
          <EmptyState onNewFood={() => setNewFav(true)} />
        ) : (
          <div className="space-y-2 max-w-2xl mx-auto">
            {favorites.map((f) => (
              <button
                key={`f-${f.id}`}
                onClick={() => setEditFav(f)}
                className="w-full text-left flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 truncate">{f.name}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">FOOD</span>
                  </div>
                  {f.serving && <div className="text-xs text-gray-500 mt-0.5">{f.serving}</div>}
                </div>
                <div className="text-base font-bold text-blue-600 tabular-nums">{Math.round(f.macros.calories)} kcal</div>
              </button>
            ))}
            {recipes.map((r) => (
              <RecipeRow key={`r-${r.id}`} recipe={r} />
            ))}
          </div>
        )}
      </div>

      {(newFav || editFav) && (
        <FavoriteEditModal
          favorite={editFav}
          onClose={() => { setNewFav(false); setEditFav(null) }}
        />
      )}
    </div>
  )
}

function RecipeRow({ recipe }: { recipe: Recipe }) {
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 truncate">{recipe.name}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">RECIPE</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {recipe.ingredients.length} ingredient{recipe.ingredients.length === 1 ? '' : 's'} · yields {fmt(recipe.yields_servings)}
        </div>
      </div>
      <div className="text-base font-bold text-blue-600 tabular-nums">{recipe.per_serving_macros.calories} kcal</div>
    </Link>
  )
}

function FavoriteEditModal({ favorite, onClose }: { favorite: Favorite | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!favorite
  const [name, setName] = useState('')
  const [serving, setServing] = useState('')
  const [cals, setCals] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(favorite?.name ?? '')
    setServing(favorite?.serving ?? '')
    setCals(favorite ? String(Math.round(favorite.macros.calories)) : '')
    setProtein(favorite ? String(favorite.macros.protein_g) : '')
    setCarbs(favorite ? String(favorite.macros.carbs_g) : '')
    setFat(favorite ? String(favorite.macros.fat_g) : '')
  }, [favorite])

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        serving: serving.trim(),
        macros: {
          calories: Number(cals) || 0, protein_g: Number(protein) || 0,
          carbs_g: Number(carbs) || 0, fat_g: Number(fat) || 0,
        } as Macros,
      }
      if (isEdit && favorite) await nutritionApi.favorites.update(favorite.id, body)
      else await nutritionApi.favorites.create(body)
      void qc.invalidateQueries({ queryKey: ['favorites'] })
      toast.success('Saved')
      onClose()
    } catch {
      toast.error('Could not save')
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!favorite || !window.confirm(`Delete "${favorite.name}"?`)) return
    try {
      await nutritionApi.favorites.remove(favorite.id)
      void qc.invalidateQueries({ queryKey: ['favorites'] })
      toast.success('Deleted')
      onClose()
    } catch {
      toast.error('Could not delete')
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900 mb-3">{isEdit ? 'Edit food' : 'New food'}</h2>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clover Greek Yoghurt" />
        <label className="block text-xs font-semibold text-gray-500 mb-1">Serving</label>
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" value={serving} onChange={(e) => setServing(e.target.value)} placeholder="e.g. 1 cup (150g)" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          {([['Calories', cals, setCals], ['Protein g', protein, setProtein], ['Carbs g', carbs, setCarbs], ['Fat g', fat, setFat]] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
            <div key={label}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-center" value={val} onChange={(e) => set(e.target.value)} />
            </div>
          ))}
        </div>
        <button onClick={() => void save()} disabled={!name.trim() || saving} className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save food'}
        </button>
        {isEdit && (
          <button onClick={() => void del()} className="w-full mt-2 py-2 text-sm text-red-600 font-medium">Delete food</button>
        )}
        <button onClick={onClose} className="w-full mt-1 py-2 text-sm text-gray-500">Cancel</button>
      </div>
    </div>
  )
}

function EmptyState({ onNewFood }: { onNewFood: () => void }) {
  return (
    <div className="max-w-md mx-auto text-center py-16 px-4">
      <h2 className="text-lg font-bold text-gray-900">No saved foods yet</h2>
      <p className="text-sm text-gray-500 mt-2 leading-relaxed">
        Save foods you eat often and recipes you make, then log them in one tap from Add Food.
      </p>
      <div className="flex gap-2 justify-center mt-4">
        <button onClick={onNewFood} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-full hover:bg-blue-700">
          + New food
        </button>
        <Link to="/recipes/new" className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-full hover:bg-gray-50">
          + New recipe
        </Link>
      </div>
    </div>
  )
}
