import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Equipment, Exercise, Muscle, MovementPattern } from '@fitness/shared-types'
import { exercisesApi } from '../services/api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MUSCLE_OPTIONS: Muscle[] = [
  'chest', 'back', 'quads', 'hamstrings', 'glutes',
  'shoulders', 'biceps', 'triceps', 'core', 'calves', 'forearms',
]

const PATTERN_OPTIONS: MovementPattern[] = ['push', 'pull', 'squat', 'hinge', 'carry', 'core']

const EQUIPMENT_OPTIONS: Equipment[] = [
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'trx', 'other',
]

const DIFFICULTY_OPTIONS = ['beginner', 'intermediate', 'advanced']

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

const PAGE_SIZE = 60

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

function ExerciseThumbnail({ exercise }: { exercise: Exercise }) {
  const [imgError, setImgError] = useState(false)
  const firstImage = exercise.images?.[0]
  const muscle = exercise.primary_muscles[0] ?? 'back'
  const color = MUSCLE_COLORS[muscle] ?? '#9ca3af'
  const initial = exercise.name[0]?.toUpperCase() ?? '?'

  if (firstImage && !imgError) {
    return (
      <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
        <img
          src={firstImage}
          alt={exercise.name}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      </div>
    )
  }

  return (
    <div
      className="w-14 h-14 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-xl font-bold"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exercise card (list row)
// ---------------------------------------------------------------------------

function ExerciseRow({ exercise }: { exercise: Exercise }) {
  return (
    <Link
      to={`/library/${exercise.id}`}
      className="card flex items-center gap-3 p-3 mb-2 hover:shadow-md transition-shadow"
    >
      <ExerciseThumbnail exercise={exercise} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 truncate">{exercise.name}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {exercise.primary_muscles.map((m) => (
            <span
              key={m}
              className="px-2 py-0.5 rounded-full text-xs font-medium text-white capitalize"
              style={{ backgroundColor: MUSCLE_COLORS[m] ?? '#9ca3af' }}
            >
              {m}
            </span>
          ))}
          {exercise.secondary_muscles.slice(0, 2).map((m) => (
            <span
              key={m}
              className="px-2 py-0.5 rounded-full text-xs capitalize"
              style={{ backgroundColor: (MUSCLE_COLORS[m] ?? '#9ca3af') + '33', color: MUSCLE_COLORS[m] ?? '#9ca3af' }}
            >
              {m}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-0.5 capitalize">{exercise.equipment}</p>
      </div>
      {exercise.difficulty && (
        <span className="text-xs text-gray-400 flex-shrink-0 capitalize">{exercise.difficulty}</span>
      )}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Main Library page
// ---------------------------------------------------------------------------

export default function Library() {
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | ''>('')
  const [pattern, setPattern] = useState<MovementPattern | ''>('')
  const [equipment, setEquipment] = useState<Equipment | ''>('')
  const [difficulty, setDifficulty] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  // Server-side: q, muscle, pattern
  const { data: allExercises = [], isLoading } = useQuery({
    queryKey: ['exercises', q, muscle, pattern],
    queryFn: () =>
      exercisesApi.list({
        ...(q ? { q } : {}),
        ...(muscle ? { muscle } : {}),
        ...(pattern ? { pattern } : {}),
      }),
    staleTime: 5 * 60_000,
  })

  // Client-side: equipment, difficulty
  const filtered = allExercises.filter((ex) => {
    if (equipment && ex.equipment !== equipment) return false
    if (difficulty && ex.difficulty?.toLowerCase() !== difficulty) return false
    return true
  })

  const shown = filtered.slice(0, visible)
  const hasMore = visible < filtered.length

  const resetVisible = () => setVisible(PAGE_SIZE)

  const handleMuscle = (m: Muscle | '') => {
    setMuscle(m)
    resetVisible()
  }

  const handlePattern = (p: MovementPattern | '') => {
    setPattern(p)
    resetVisible()
  }

  const handleEquipment = (e: Equipment | '') => {
    setEquipment(e)
    resetVisible()
  }

  const handleDifficulty = (d: string) => {
    setDifficulty(d)
    resetVisible()
  }

  return (
    <div className="flex-1 flex flex-col p-4">
      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search exercises..."
          value={q}
          onChange={(e) => { setQ(e.target.value); resetVisible() }}
          className="w-full border border-gray-200 rounded-xl px-3 h-10 text-sm focus:outline-none focus:border-blue-400 bg-white"
        />
      </div>

      {/* Muscle filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-2 scrollbar-hide">
        <button
          onClick={() => handleMuscle('')}
          className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
            muscle === '' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
          }`}
        >
          All muscles
        </button>
        {MUSCLE_OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => handleMuscle(muscle === m ? '' : m)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border capitalize transition-colors ${
              muscle === m ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'
            }`}
            style={muscle === m ? { backgroundColor: MUSCLE_COLORS[m] ?? '#9ca3af', borderColor: MUSCLE_COLORS[m] ?? '#9ca3af' } : {}}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Pattern filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-2 scrollbar-hide">
        <button
          onClick={() => handlePattern('')}
          className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
            pattern === '' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
          }`}
        >
          All patterns
        </button>
        {PATTERN_OPTIONS.map((p) => (
          <button
            key={p}
            onClick={() => handlePattern(pattern === p ? '' : p)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border capitalize ${
              pattern === p ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Equipment + difficulty row */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <select
          value={equipment}
          onChange={(e) => handleEquipment(e.target.value as Equipment | '')}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:border-blue-400 capitalize"
        >
          <option value="">Any equipment</option>
          {EQUIPMENT_OPTIONS.map((e) => (
            <option key={e} value={e} className="capitalize">{e === 'trx' ? 'TRX' : e}</option>
          ))}
        </select>
        <select
          value={difficulty}
          onChange={(e) => handleDifficulty(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:border-blue-400 capitalize"
        >
          <option value="">Any difficulty</option>
          {DIFFICULTY_OPTIONS.map((d) => (
            <option key={d} value={d} className="capitalize">{d}</option>
          ))}
        </select>
        {(muscle || pattern || equipment || difficulty || q) && (
          <button
            onClick={() => {
              setMuscle('')
              setPattern('')
              setEquipment('')
              setDifficulty('')
              setQ('')
              resetVisible()
            }}
            className="px-3 py-1 rounded-full text-xs text-red-400 border border-red-200 bg-white"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Count */}
      {!isLoading && (
        <p className="text-xs text-gray-400 mb-3">
          {filtered.length === 0 ? 'No exercises found' : `${filtered.length} exercise${filtered.length === 1 ? '' : 's'}`}
        </p>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            No exercises match your filters. Try adjusting or clearing them.
          </p>
        ) : (
          <>
            {shown.map((ex) => (
              <ExerciseRow key={ex.id} exercise={ex} />
            ))}
            {hasMore && (
              <button
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="w-full border border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 font-medium hover:border-blue-300 hover:text-blue-400 mt-2 mb-4"
              >
                Show more ({filtered.length - visible} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
