import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Exercise } from '@fitness/shared-types'
import { exercisesApi, workoutsApi } from '../services/api'
import { toLocalISODate } from '../lib/dates'
import { buildEntryFromHistory } from '../lib/addExercise'
import { formatLastTime } from '../lib/workoutHelpers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MUSCLE_COLORS: Record<string, string> = {
  chest: '#ef4444',
  back: '#3b82f6',
  quads: '#f97316',
  hamstrings: '#f59e0b',
  glutes: '#ec4899',
  shoulders: '#8b5cf6',
  biceps: '#06b6d4',
  triceps: '#14b8a6',
  core: '#84cc16',
  calves: '#6366f1',
  forearms: '#6b7280',
}

const DIFFICULTY_COLOR: Record<string, string> = {
  beginner: '#22c55e',
  intermediate: '#f59e0b',
  advanced: '#ef4444',
}

// ---------------------------------------------------------------------------
// Photo toggle pair
// ---------------------------------------------------------------------------

function PhotoPair({ images, name }: { images: string[]; name: string }) {
  const [idx, setIdx] = useState(0)
  if (images.length === 0) return null

  return (
    <div
      className="relative w-full aspect-video bg-gray-100 rounded-xl overflow-hidden mb-4 cursor-pointer"
      onClick={() => setIdx((i) => (images.length > 1 ? (i + 1) % images.length : i))}
    >
      <img
        src={images[idx]}
        alt={name}
        className="w-full h-full object-cover"
      />
      {images.length > 1 && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          {images.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${i === idx ? 'bg-white' : 'bg-white/50'}`}
            />
          ))}
        </div>
      )}
      {images.length > 1 && (
        <div className="absolute bottom-2 left-2 text-white text-xs bg-black/30 rounded px-1.5 py-0.5">
          Tap to toggle
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alternatives horizontal scroll
// ---------------------------------------------------------------------------

function AlternativeCard({ exercise }: { exercise: Exercise }) {
  const [imgError, setImgError] = useState(false)
  const firstImage = exercise.images?.[0]
  const muscle = exercise.primary_muscles[0] ?? 'back'
  const color = MUSCLE_COLORS[muscle] ?? '#9ca3af'
  const initial = exercise.name[0]?.toUpperCase() ?? '?'

  return (
    <Link
      to={`/library/${exercise.id}`}
      className="card flex-shrink-0 w-36 p-3 hover:shadow-md transition-shadow"
    >
      <div className="w-full aspect-square rounded-lg overflow-hidden bg-gray-100 mb-2">
        {firstImage && !imgError ? (
          <img
            src={firstImage}
            alt={exercise.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-white text-2xl font-bold"
            style={{ backgroundColor: color }}
          >
            {initial}
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-gray-900 leading-tight line-clamp-2">{exercise.name}</p>
      <p className="text-xs text-gray-400 capitalize mt-0.5">{exercise.equipment}</p>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Main detail page
// ---------------------------------------------------------------------------

export default function LibraryDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)

  // Fetch exercise - try from exercises list cache first, fall back to individual fetch
  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ['exercises', '', '', ''],
    queryFn: () => exercisesApi.list(),
    staleTime: 5 * 60_000,
  })

  const exercise = exercises.find((e) => e.id === id)

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['exercise-history', id],
    queryFn: () => exercisesApi.history(id!, 3),
    enabled: !!id,
    staleTime: 60_000,
  })

  const { data: alternatives = [], isLoading: altsLoading } = useQuery({
    queryKey: ['alternatives', id],
    queryFn: () => exercisesApi.alternatives(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })

  const { data: activeWorkout } = useQuery({
    queryKey: ['workout', 'active'],
    queryFn: () => workoutsApi.active(),
    staleTime: 0,
  })

  const handleAddToWorkout = async () => {
    if (!exercise) return
    setAdding(true)
    try {
      let workoutId: string
      const active = activeWorkout

      if (active) {
        workoutId = active.id
      } else {
        // Start a new workout
        const created = await workoutsApi.create({ date: toLocalISODate() })
        workoutId = created.id
        void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      }

      // Fetch history for prefill
      let hist = history
      if (hist.length === 0) {
        try {
          hist = await exercisesApi.history(exercise.id, 1)
        } catch {
          hist = []
        }
      }

      const entry = buildEntryFromHistory(exercise, hist)
      // Fetch current workout to get existing entries
      const currentWorkout = await workoutsApi.get(workoutId)
      const newEntries = [...currentWorkout.entries, { ...entry }]
      await workoutsApi.update(workoutId, { entries: newEntries })
      void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      toast.success(`${exercise.name} added`)
      navigate('/workout')
    } catch {
      toast.error('Could not add exercise')
    } finally {
      setAdding(false)
    }
  }

  if (!exercise) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Exercise not found.</p>
      </div>
    )
  }

  const difficultyColor = exercise.difficulty
    ? (DIFFICULTY_COLOR[exercise.difficulty.toLowerCase()] ?? '#9ca3af')
    : null

  const ctaLabel = activeWorkout ? 'Add to current workout' : 'Start workout with this'

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-blue-500 text-sm mb-4"
        >
          &lt; Back
        </button>

        {/* Photos */}
        {exercise.images && exercise.images.length > 0 && (
          <PhotoPair images={exercise.images} name={exercise.name} />
        )}

        {/* Name + difficulty */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <h1 className="text-xl font-bold text-gray-900 flex-1">{exercise.name}</h1>
          {exercise.difficulty && difficultyColor && (
            <span
              className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold text-white capitalize"
              style={{ backgroundColor: difficultyColor }}
            >
              {exercise.difficulty}
            </span>
          )}
        </div>

        {/* Muscles */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Muscles</p>
          <div className="flex flex-wrap gap-1.5">
            {exercise.primary_muscles.map((m) => (
              <span
                key={`p-${m}`}
                className="px-2.5 py-1 rounded-full text-xs font-medium text-white capitalize"
                style={{ backgroundColor: MUSCLE_COLORS[m] ?? '#9ca3af' }}
              >
                {m}
              </span>
            ))}
            {exercise.secondary_muscles.map((m) => (
              <span
                key={`s-${m}`}
                className="px-2.5 py-1 rounded-full text-xs capitalize"
                style={{
                  backgroundColor: (MUSCLE_COLORS[m] ?? '#9ca3af') + '33',
                  color: MUSCLE_COLORS[m] ?? '#9ca3af',
                  border: `1px solid ${MUSCLE_COLORS[m] ?? '#9ca3af'}55`,
                }}
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Equipment + pattern */}
        <div className="flex gap-4 mb-5">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Equipment</p>
            <p className="text-sm text-gray-700 capitalize">{exercise.equipment}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Pattern</p>
            <p className="text-sm text-gray-700 capitalize">{exercise.movement_pattern}</p>
          </div>
        </div>

        {/* Instructions */}
        {exercise.instructions && exercise.instructions.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Instructions</p>
            <ol className="space-y-2">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* History */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your history</p>
          {histLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400">No history yet. Log a session with this exercise to see it here.</p>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.workout_id} className="card p-3">
                  <p className="text-xs text-gray-400 mb-1">{item.date}</p>
                  <p className="text-sm text-gray-700">{formatLastTime(item.sets, item.date)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alternatives */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Alternatives</p>
          {altsLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : alternatives.length === 0 ? (
            <p className="text-sm text-gray-400">No alternatives found.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {alternatives.map((alt) => (
                <AlternativeCard key={alt.id} exercise={alt} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3 safe-bottom">
        <button
          onClick={() => void handleAddToWorkout()}
          disabled={adding}
          className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl text-sm"
        >
          {adding ? 'Adding...' : ctaLabel}
        </button>
      </div>
    </div>
  )
}
