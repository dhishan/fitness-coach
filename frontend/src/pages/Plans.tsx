/**
 * Browse all workout plans. Tap a plan to view/edit, Start to begin a
 * session from it, or "+ New plan" to create one.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { WorkoutTemplate } from '@fitness/shared-types'
import { templatesApi } from '../services/api'
import { startFromPlan } from '../lib/startFromPlan'

export default function Plans() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [startingId, setStartingId] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
  })

  const handleStart = async (t: WorkoutTemplate) => {
    setStartingId(t.id)
    try {
      await startFromPlan(t)
      void qc.invalidateQueries({ queryKey: ['workout-active'] })
      navigate('/workout')
    } catch {
      toast.error('Could not start workout from this plan.')
    } finally {
      setStartingId(null)
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-900">Plans</h1>
        <button
          onClick={() => navigate('/plans/new')}
          className="text-sm font-semibold text-primary-600 hover:text-primary-700"
        >
          + New plan
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-semibold text-gray-900">No plans yet</p>
          <p className="text-sm text-gray-500 mt-1">Create a plan to start sessions faster.</p>
          <button
            onClick={() => navigate('/plans/new')}
            className="mt-4 rounded-lg bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600"
          >
            + New plan
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="card flex items-center gap-3 p-4">
              <button onClick={() => navigate(`/plans/${t.id}`)} className="flex-1 text-left">
                <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t.entries.length} exercise{t.entries.length === 1 ? '' : 's'}
                </p>
              </button>
              <button
                onClick={() => void handleStart(t)}
                disabled={startingId === t.id}
                className="rounded-lg bg-primary-500 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
              >
                {startingId === t.id ? '…' : 'Start'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
