import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Workout } from '@fitness/shared-types'
import { dashboardApi, workoutsApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'
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

export default function Home() {
  const navigate = useNavigate()
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

  const lastWorkout = recentList?.items[0] ?? null
  const isResuming = !!activeWorkout

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

      {/* 4. Progress chart */}
      <ProgressChart />

      {/* 5. Muscle split */}
      {loadingMuscle ? (
        <Skeleton className="h-40" />
      ) : (
        <MuscleSplit data={muscleSplit ?? {}} />
      )}
    </div>
  )
}
