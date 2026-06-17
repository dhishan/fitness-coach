/**
 * Recipes list page. Tap a row to edit, "+ New" to create.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Recipe } from '@fitness/shared-types'
import { nutritionApi } from '../services/api'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export default function Recipes() {
  const { data, isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
  })

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <h1 className="text-lg font-bold text-gray-900">Recipes</h1>
        <Link
          to="/recipes/new"
          className="text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          + New recipe
        </Link>
      </div>

      <div className="flex-1 p-4">
        {isLoading ? (
          <div className="text-center text-gray-400 mt-8">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2 max-w-2xl mx-auto">
            {data.map((r) => (
              <RecipeRow key={r.id} recipe={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RecipeRow({ recipe }: { recipe: Recipe }) {
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900">{recipe.name}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {recipe.ingredients.length} ingredient
          {recipe.ingredients.length === 1 ? '' : 's'} · yields{' '}
          {fmt(recipe.yields_servings)} serving
          {recipe.yields_servings === 1 ? '' : 's'}
        </div>
      </div>
      <div className="text-right">
        <div className="text-base font-bold text-blue-600 tabular-nums">
          {recipe.per_serving_macros.calories} kcal
        </div>
        <div className="text-[11px] text-gray-500 tabular-nums">
          P {fmt(recipe.per_serving_macros.protein_g)} · C{' '}
          {fmt(recipe.per_serving_macros.carbs_g)} · F{' '}
          {fmt(recipe.per_serving_macros.fat_g)}
        </div>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="max-w-md mx-auto text-center py-16 px-4">
      <h2 className="text-lg font-bold text-gray-900">No recipes yet</h2>
      <p className="text-sm text-gray-500 mt-2 leading-relaxed">
        Build your own meals from labeled ingredients. We sum the macros and
        store per-serving totals so logging is one tap.
      </p>
      <Link
        to="/recipes/new"
        className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-full hover:bg-blue-700"
      >
        + Create your first recipe
      </Link>
    </div>
  )
}
