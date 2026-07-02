import { useRef, useEffect, useCallback, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { workoutsApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'
import type { Workout } from '@fitness/shared-types'

// ---- helpers ----

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatVolume(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k kg'
  return v + ' kg'
}

function exerciseNamesLine(w: Workout): string {
  const names = w.entries.map((e) => e.exercise_name)
  if (names.length === 0) return 'No exercises'
  if (names.length <= 3) return names.join(', ')
  return names.slice(0, 3).join(', ') + ' +' + (names.length - 3) + ' more'
}

// ---- Calendar ----

function ym(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function CalendarView({ year, month, onPrev, onNext }: {
  year: number
  month: number
  onPrev: () => void
  onNext: () => void
}) {
  const navigate = useNavigate()
  const todayStr = toLocalISODate()
  const [todayYear, todayMonth] = todayStr.split('-').map(Number)
  const isFutureMonth = year > todayYear || (year === todayYear && month > todayMonth - 1)

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const fromStr = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0)
  const toStr = toLocalISODate(lastDay)

  const ymKey = ym(year, month)
  const { data: monthData } = useQuery({
    queryKey: ['workouts-month', ymKey],
    queryFn: () => workoutsApi.list({ from: fromStr, to: toStr, limit: 100 }),
    staleTime: 5 * 60_000,
  })

  const workoutsByDate = new Map<string, Workout[]>()
  for (const w of (monthData?.items ?? [])) {
    const existing = workoutsByDate.get(w.date) ?? []
    existing.push(w)
    workoutsByDate.set(w.date, existing)
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onPrev}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
        >
          &lt;
        </button>
        <span className="text-sm font-semibold text-gray-800">{monthLabel}</span>
        <button
          onClick={onNext}
          disabled={isFutureMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          &gt;
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayLabels.map((d) => (
          <div key={d} className="text-center text-xs text-gray-400 font-medium">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const workouts = workoutsByDate.get(dateStr) ?? []
          const hasWorkout = workouts.length > 0
          const isToday = dateStr === todayStr
          return (
            <button
              key={i}
              onClick={() => {
                if (workouts.length === 1) navigate(`/history/${workouts[0].id}`)
              }}
              disabled={workouts.length === 0}
              className={[
                'aspect-square flex items-center justify-center rounded-lg text-xs font-medium transition-colors',
                hasWorkout
                  ? 'bg-primary-500 text-white hover:bg-primary-600'
                  : isToday
                  ? 'border border-primary-300 text-primary-500'
                  : 'text-gray-400',
                workouts.length === 0 ? 'cursor-default' : 'cursor-pointer',
              ].join(' ')}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- Row ----

function WorkoutRow({ workout }: { workout: Workout }) {
  const navigate = useNavigate()
  return (
    <button
      className="card p-4 w-full text-left flex items-center justify-between hover:shadow-md transition-shadow"
      onClick={() => navigate(`/history/${workout.id}`)}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900">{workout.title || formatDate(workout.date)}</div>
        <div className="text-xs text-gray-500 truncate mt-0.5">
          {workout.title ? `${formatDate(workout.date)} · ` : ''}{exerciseNamesLine(workout)}
        </div>
      </div>
      <div className="ml-3 text-sm font-medium text-gray-700 shrink-0">{formatVolume(workout.total_volume)}</div>
    </button>
  )
}

// ---- Main ----

export default function History() {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const sentinelRef = useRef<HTMLDivElement>(null)

  const today = toLocalISODate()
  const [todayYear, todayMonth] = today.split('-').map(Number)
  const [calYear, setCalYear] = useState(todayYear)
  const [calMonth, setCalMonth] = useState(todayMonth - 1) // 0-indexed

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['workouts'],
    queryFn: ({ pageParam = 0 }) =>
      workoutsApi.list({ limit: 20, offset: pageParam as number }),
    getNextPageParam: (lastPage, allPages) => {
      const accumulated = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (accumulated < lastPage.total) return accumulated
      return undefined
    },
    initialPageParam: 0,
    staleTime: 5 * 60_000,
  })

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage()
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(handleObserver, { threshold: 0 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [handleObserver])

  const total = data?.pages[0]?.total ?? 0
  const allWorkouts = data?.pages.flatMap((p) => p.items) ?? []

  // Self-heal missing workout names. Naming normally fires once on Finish, but
  // that client call can be lost (tab closed mid-request, finished on a stale
  // build, cold-start timeout). Retry any finished-but-untitled workout on load.
  // The endpoint is idempotent + server rate-limited, so already-named workouts
  // cost nothing. Each id is attempted once per mount to avoid a refetch loop.
  const qc = useQueryClient()
  const healedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const untitled = allWorkouts.filter(
      (w) => w.ended_at && !w.title && !healedRef.current.has(w.id),
    )
    if (untitled.length === 0) return
    untitled.forEach((w) => healedRef.current.add(w.id))
    let named = false
    void Promise.all(
      untitled.map((w) =>
        workoutsApi
          .generateTitle(w.id)
          .then((res) => { if (res?.title) named = true })
          .catch(() => {}),
      ),
    ).then(() => {
      if (named) {
        void qc.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            typeof q.queryKey[0] === 'string' &&
            (q.queryKey[0] === 'workouts' ||
              q.queryKey[0] === 'workouts-month'),
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allWorkouts.length])

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11) }
    else setCalMonth(calMonth - 1)
  }
  const nextMonth = () => {
    const [cy, cm] = today.split('-').map(Number)
    const nextY = calMonth === 11 ? calYear + 1 : calYear
    const nextM = calMonth === 11 ? 0 : calMonth + 1
    if (nextY > cy || (nextY === cy && nextM > cm - 1)) return
    setCalYear(nextY)
    setCalMonth(nextM)
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {status === 'success' ? `${total} workout${total === 1 ? '' : 's'}` : 'History'}
        </h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            Calendar
          </button>
        </div>
      </div>

      {view === 'calendar' && (
        <CalendarView year={calYear} month={calMonth} onPrev={prevMonth} onNext={nextMonth} />
      )}

      {view === 'list' && (
        <>
          {status === 'pending' && (
            <div className="text-center text-sm text-gray-400 py-8">Loading...</div>
          )}
          {status === 'success' && allWorkouts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-gray-500 text-sm">No workouts yet. Start your first session.</p>
            </div>
          )}
          {allWorkouts.map((w) => (
            <WorkoutRow key={w.id} workout={w} />
          ))}
          <div ref={sentinelRef} className="h-4" />
          {isFetchingNextPage && (
            <div className="text-center text-xs text-gray-400 py-2">Loading more...</div>
          )}
        </>
      )}
    </div>
  )
}
