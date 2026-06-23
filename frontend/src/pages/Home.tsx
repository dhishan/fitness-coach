import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Workout, WorkoutTemplate, BodyMetric, CardioLog } from '@fitness/shared-types'
import { dashboardApi, templatesApi, workoutsApi, bodyApi, cardioApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'
import { startFromPlan } from '../lib/startFromPlan'
import WeekStrip from '../components/home/WeekStrip'
import ProgressChart from '../components/home/ProgressChart'
import MuscleSplit from '../components/home/MuscleSplit'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-100 rounded-xl animate-pulse ${className}`} />
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function activeDuration(workout: Workout): string {
  if (!workout.started_at) return ''
  const start = new Date(workout.started_at)
  const now = new Date()
  const mins = Math.floor((now.getTime() - start.getTime()) / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function BodyCard() {
  const qc = useQueryClient()
  const [weightInput, setWeightInput] = useState('')

  const { data: metrics = [], isLoading } = useQuery<BodyMetric[]>({
    queryKey: ['body', { limit: 30 }],
    queryFn: () => bodyApi.list({ limit: 30 }),
  })

  const logMutation = useMutation({
    mutationFn: (weight: number) =>
      bodyApi.create({ date: toLocalISODate(), weight_kg: weight }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['body'] })
      setWeightInput('')
      toast.success('Weight logged')
    },
    onError: () => toast.error('Failed to log weight'),
  })

  const latest = metrics[0] ?? null

  // delta vs entry closest to 7 days ago
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoStr = toLocalISODate(sevenDaysAgo)
  const priorEntry = metrics.find((m) => m.date <= sevenDaysAgoStr) ?? null
  const delta =
    latest && priorEntry && priorEntry.id !== latest.id
      ? latest.weight_kg - priorEntry.weight_kg
      : null

  const handleLog = () => {
    const val = parseFloat(weightInput)
    if (!weightInput || isNaN(val) || val <= 0) {
      toast.error('Enter a valid weight')
      return
    }
    logMutation.mutate(val)
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Body</span>
        <Link to="/body" className="text-xs text-primary-600 font-medium hover:text-primary-700">
          View history
        </Link>
      </div>

      {isLoading ? (
        <Skeleton className="h-10" />
      ) : !latest ? (
        <p className="text-sm text-gray-400 mb-3">No weigh-ins yet. Log your weight to track changes.</p>
      ) : (
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-lg font-semibold text-gray-900">{latest.weight_kg} kg</span>
          {delta !== null && (
            <span className={`text-xs font-medium ${delta < 0 ? 'text-green-600' : delta > 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)} vs last week
            </span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0.1"
          max="400"
          value={weightInput}
          onChange={(e) => setWeightInput(e.target.value)}
          placeholder="kg"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
        <button
          onClick={handleLog}
          disabled={logMutation.isPending}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          Log
        </button>
      </div>
    </div>
  )
}

function CardioCard() {
  const today = toLocalISODate()
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fromDate = toLocalISODate(sevenDaysAgo)

  const { data: logs = [], isLoading } = useQuery<CardioLog[]>({
    queryKey: ['cardio', { from: fromDate, to: today }],
    queryFn: () => cardioApi.list({ from: fromDate, to: today }),
  })

  const totalMins = Math.round(logs.reduce((sum, l) => sum + l.duration_s, 0) / 60)
  const totalDistM = logs.reduce((sum, l) => sum + (l.distance_m ?? 0), 0)
  const totalDistKm = totalDistM / 1000

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Cardio</span>
        <Link to="/cardio" className="text-xs text-primary-600 font-medium hover:text-primary-700">
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-400">No cardio logged yet. Log a session to start tracking.</p>
      ) : (
        <div className="flex gap-4">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-gray-900">{logs.length}</span>
            <span className="text-xs text-gray-400">sessions</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-gray-900">{totalMins}</span>
            <span className="text-xs text-gray-400">min</span>
          </div>
          {totalDistKm > 0 && (
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-gray-900">{totalDistKm.toFixed(1)}</span>
              <span className="text-xs text-gray-400">km</span>
            </div>
          )}
          <div className="flex flex-col justify-end ml-auto">
            <span className="text-xs text-gray-400">last 7 days</span>
          </div>
        </div>
      )}
    </div>
  )
}

function PlansSection({ templates, onStart }: { templates: WorkoutTemplate[]; onStart: (t: WorkoutTemplate) => void }) {
  const navigate = useNavigate()
  return (
    <div className="card p-4">
      {/* Big browse buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => navigate('/library')}
          className="flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-4 text-sm font-bold text-blue-600 hover:bg-blue-100"
        >
          <span className="text-lg">🏋️</span> Browse Exercises
        </button>
        <button
          onClick={() => navigate('/plans')}
          className="flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-4 text-sm font-bold text-blue-600 hover:bg-blue-100"
        >
          <span className="text-lg">📋</span> Browse Plans
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Your plans</span>
        <button
          onClick={() => navigate('/plans/new')}
          className="text-xs text-primary-600 font-medium hover:text-primary-700"
        >
          + New plan
        </button>
      </div>
      {templates.length === 0 ? (
        <p className="text-sm text-gray-400">No plans yet. Create one to start sessions faster.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <button
                onClick={() => navigate(`/plans/${t.id}`)}
                className="flex-1 text-left"
              >
                <p className="text-sm font-medium text-gray-800">{t.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t.entries.length} exercise{t.entries.length === 1 ? '' : 's'}
                </p>
              </button>
              <button
                onClick={() => onStart(t)}
                className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Start
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const today = toLocalISODate()

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['dashboard-summary', today],
    queryFn: () => dashboardApi.summary(today),
  })

  const { data: activeWorkout } = useQuery({
    queryKey: ['workout-active'],
    queryFn: () => workoutsApi.active(),
  })

  const { data: recentList, isLoading: loadingRecent } = useQuery({
    queryKey: ['workouts-list', { limit: 1 }],
    queryFn: () => workoutsApi.list({ limit: 1 }),
  })

  const { data: muscleSplit, isLoading: loadingMuscle } = useQuery({
    queryKey: ['muscle-split', today],
    queryFn: () => dashboardApi.muscleSplit(today, 4),
  })

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
  })

  const lastWorkout = recentList?.items[0] ?? null
  const isResuming = !!activeWorkout

  const handleStartPlan = async (template: WorkoutTemplate) => {
    const loadingToast = toast.loading(`Starting "${template.name}"...`)
    try {
      const workoutId = await startFromPlan(template)
      void qc.invalidateQueries({ queryKey: ['workout-active'] })
      toast.dismiss(loadingToast)
      navigate('/workout')
      // small delay to let invalidation propagate
      void qc.invalidateQueries({ queryKey: ['workout', workoutId] })
    } catch {
      toast.dismiss(loadingToast)
      toast.error('Could not start plan')
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">

      {/* 1. Start / Resume strip */}
      <div className="card p-4">
        <button
          onClick={() => navigate('/workout')}
          className="w-full py-3.5 rounded-xl bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-base font-semibold transition-colors"
        >
          {isResuming ? 'RESUME WORKOUT' : 'START WORKOUT'}
        </button>
        {isResuming && activeWorkout && activeWorkout.started_at && (
          <p className="text-xs text-gray-500 text-center mt-2">
            Session in progress - {activeDuration(activeWorkout)} elapsed
          </p>
        )}
      </div>

      {/* 2. Week strip */}
      {loadingSummary ? (
        <Skeleton className="h-28" />
      ) : summary ? (
        <WeekStrip summary={summary} />
      ) : null}

      {/* 3. Last workout */}
      <div className="card p-4">
        <span className="text-sm font-semibold text-gray-900 block mb-2">Last workout</span>
        {loadingRecent ? (
          <Skeleton className="h-12" />
        ) : !lastWorkout ? (
          <p className="text-sm text-gray-400">No workouts yet. Start your first session.</p>
        ) : (
          <button
            className="w-full text-left"
            onClick={() => navigate(`/history/${lastWorkout.id}`)}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{formatDate(lastWorkout.date)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {lastWorkout.entries.length} exercise{lastWorkout.entries.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-primary-600">
                  {lastWorkout.total_volume >= 1000
                    ? `${(lastWorkout.total_volume / 1000).toFixed(1)}k`
                    : lastWorkout.total_volume} kg
                </p>
                <p className="text-xs text-gray-400">volume</p>
              </div>
            </div>
          </button>
        )}
      </div>

      {/* 4. Your plans */}
      {loadingTemplates ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          <PlansSection templates={templates} onStart={(t) => void handleStartPlan(t)} />
          <div className="text-center">
            <Link to="/library" className="text-xs text-primary-600 font-medium hover:text-primary-700">
              Browse exercises
            </Link>
          </div>
        </>
      )}

      {/* 5. Body card */}
      <BodyCard />

      {/* 6. Cardio card */}
      <CardioCard />

      {/* 7. Progress chart */}
      <ProgressChart />

      {/* 8. Muscle split */}
      {loadingMuscle ? (
        <Skeleton className="h-40" />
      ) : (
        <MuscleSplit data={muscleSplit ?? {}} />
      )}
    </div>
  )
}
