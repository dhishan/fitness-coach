/**
 * Parses fenced ```fitness:exercise``` / ```fitness:plan``` / ```fitness:add-to-workout```
 * blocks out of an assistant turn and renders inline cards with an Add button.
 *
 * The LLM never writes — these cards call the same authenticated APIs the user
 * would hit manually.
 */
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { useQueryClient } from '@tanstack/react-query'
import { exercisesApi, templatesApi, workoutsApi } from '../services/api'
import type { Equipment, Exercise, MovementPattern, Muscle } from '@fitness/shared-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExerciseSuggestion = {
  kind: 'exercise'
  data: {
    name: string
    primary_muscles: Muscle[]
    secondary_muscles?: Muscle[]
    movement_pattern: MovementPattern
    equipment: Equipment
  }
}
type PlanSuggestion = {
  kind: 'plan'
  data: {
    name: string
    entries: { exercise_name: string; sets?: number; reps?: string | number; rest_s?: number }[]
  }
}
type AddToWorkoutSuggestion = {
  kind: 'add-to-workout'
  data: { exercise_name: string; sets?: number; reps?: string | number }
}
type Suggestion = ExerciseSuggestion | PlanSuggestion | AddToWorkoutSuggestion

type Chunk =
  | { kind: 'text'; text: string }
  | { kind: 'suggestion'; suggestion: Suggestion }

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const BLOCK_RE = /```fitness:(exercise|plan|add-to-workout)\s*\n([\s\S]*?)```/g

export function parseTurn(content: string): Chunk[] {
  const chunks: Chunk[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  BLOCK_RE.lastIndex = 0
  while ((m = BLOCK_RE.exec(content)) !== null) {
    if (m.index > cursor) chunks.push({ kind: 'text', text: content.slice(cursor, m.index) })
    try {
      const data = JSON.parse(m[2].trim())
      chunks.push({
        kind: 'suggestion',
        suggestion: { kind: m[1] as Suggestion['kind'], data } as Suggestion,
      })
    } catch {
      chunks.push({ kind: 'text', text: m[0] })
    }
    cursor = m.index + m[0].length
  }
  if (cursor < content.length) chunks.push({ kind: 'text', text: content.slice(cursor) })
  return chunks
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveExerciseId(name: string): Promise<Exercise | null> {
  try {
    const matches = await exercisesApi.list({ q: name })
    if (!matches.length) return null
    const exact = matches.find(
      (e) => e.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    return exact ?? matches[0]
  } catch {
    return null
  }
}

type AddState = 'idle' | 'saving' | 'saved' | 'error'

function CardShell({
  title,
  subtitle,
  addLabel,
  onAdd,
  state,
  errorMsg,
}: {
  title: string
  subtitle: string
  addLabel: string
  onAdd: () => void
  state: AddState
  errorMsg: string
}) {
  const disabled = state === 'saving' || state === 'saved'
  const btnText =
    state === 'saving' ? '...' : state === 'saved' ? '✓ Added' : addLabel
  return (
    <div className="my-2 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        <div className="mt-0.5 whitespace-pre-line text-xs text-gray-500">{subtitle}</div>
        {state === 'error' && errorMsg ? (
          <div className="mt-1 text-xs text-red-600">{errorMsg}</div>
        ) : null}
      </div>
      <button
        onClick={onAdd}
        disabled={disabled}
        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-white ${
          disabled ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {btnText}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function ExerciseCard({ s }: { s: ExerciseSuggestion }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AddState>('idle')
  const [err, setErr] = useState('')
  const onAdd = async () => {
    setState('saving'); setErr('')
    try {
      await exercisesApi.create({
        name: s.data.name,
        primary_muscles: s.data.primary_muscles,
        secondary_muscles: s.data.secondary_muscles ?? [],
        movement_pattern: s.data.movement_pattern,
        equipment: s.data.equipment,
      })
      void qc.invalidateQueries({ queryKey: ['exercises'] })
      setState('saved')
    } catch {
      setState('error'); setErr('Could not add. Try again.')
    }
  }
  const sub = [
    s.data.primary_muscles.join(', '),
    s.data.movement_pattern,
    s.data.equipment,
  ].filter(Boolean).join(' · ')
  return (
    <CardShell
      title={s.data.name}
      subtitle={`New exercise · ${sub}`}
      addLabel="+ Add to library"
      onAdd={() => void onAdd()}
      state={state}
      errorMsg={err}
    />
  )
}

function PlanCard({ s }: { s: PlanSuggestion }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AddState>('idle')
  const [err, setErr] = useState('')
  const onAdd = async () => {
    setState('saving'); setErr('')
    try {
      const resolved = await Promise.all(
        s.data.entries.map(async (e) => ({ e, ex: await resolveExerciseId(e.exercise_name) })),
      )
      const missing = resolved.filter((r) => !r.ex).map((r) => r.e.exercise_name)
      if (missing.length) {
        setState('error')
        setErr(`Missing from library: ${missing.join(', ')}. Add them first.`)
        return
      }
      const entries = resolved.map(({ e, ex }) => ({
        exercise_id: ex!.id,
        exercise_name: ex!.name,
        target_sets: e.sets ?? 3,
        target_reps: e.reps != null ? String(e.reps) : '',
        rest_s: e.rest_s ?? 90,
      }))
      await templatesApi.create({ name: s.data.name, entries })
      void qc.invalidateQueries({ queryKey: ['templates'] })
      setState('saved')
    } catch {
      setState('error'); setErr('Could not save plan.')
    }
  }
  const preview = s.data.entries.slice(0, 3).map((e) => e.exercise_name).join(', ')
  return (
    <CardShell
      title={s.data.name}
      subtitle={`Plan · ${s.data.entries.length} exercises\n${preview}${
        s.data.entries.length > 3 ? '...' : ''
      }`}
      addLabel="+ Save plan"
      onAdd={() => void onAdd()}
      state={state}
      errorMsg={err}
    />
  )
}

function AddToWorkoutCard({ s }: { s: AddToWorkoutSuggestion }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AddState>('idle')
  const [err, setErr] = useState('')
  const onAdd = async () => {
    setState('saving'); setErr('')
    try {
      const active = await workoutsApi.active()
      if (!active) {
        setState('error'); setErr('No active workout. Start one first.')
        return
      }
      const ex = await resolveExerciseId(s.data.exercise_name)
      if (!ex) {
        setState('error'); setErr(`"${s.data.exercise_name}" is not in your library.`)
        return
      }
      const targetSets = s.data.sets ?? 3
      const targetReps = s.data.reps != null ? Number(s.data.reps) || 8 : 8
      const newEntry = {
        exercise_id: ex.id,
        exercise_name: ex.name,
        sets: Array.from({ length: targetSets }).map(() => ({
          weight: 0,
          reps: targetReps,
          is_warmup: false,
        })),
      }
      await workoutsApi.update(active.id, { entries: [...active.entries, newEntry] })
      void qc.invalidateQueries({ queryKey: ['workout-active'] })
      setState('saved')
    } catch {
      setState('error'); setErr('Could not add.')
    }
  }
  return (
    <CardShell
      title={s.data.exercise_name}
      subtitle={`Add to active workout · ${s.data.sets ?? 3} sets${
        s.data.reps != null ? ` × ${s.data.reps}` : ''
      }`}
      addLabel="+ Add to workout"
      onAdd={() => void onAdd()}
      state={state}
      errorMsg={err}
    />
  )
}

// ---------------------------------------------------------------------------
// Public renderer — drop-in replacement for <ReactMarkdown>{content}</ReactMarkdown>
// ---------------------------------------------------------------------------

const REHYPE_PLUGINS = [rehypeSanitize]

export default function CoachContent({
  content,
  mdComponents,
}: {
  content: string
  mdComponents: React.ComponentProps<typeof ReactMarkdown>['components']
}) {
  const chunks = parseTurn(content)
  return (
    <>
      {chunks.map((c, i) => {
        if (c.kind === 'text') {
          if (!c.text.trim()) return null
          return (
            <ReactMarkdown
              key={i}
              components={mdComponents}
              rehypePlugins={REHYPE_PLUGINS}
            >
              {c.text}
            </ReactMarkdown>
          )
        }
        const s = c.suggestion
        if (s.kind === 'exercise') return <ExerciseCard key={i} s={s} />
        if (s.kind === 'plan') return <PlanCard key={i} s={s} />
        if (s.kind === 'add-to-workout') return <AddToWorkoutCard key={i} s={s} />
        return null
      })}
    </>
  )
}
