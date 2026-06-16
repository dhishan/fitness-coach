/**
 * Parses fenced ```fitness:exercise``` / ```fitness:plan``` / ```fitness:add-to-workout```
 * blocks out of an assistant turn and renders inline cards with an "Add" button.
 *
 * The LLM never writes — these cards call the same authenticated APIs the user
 * would tap manually. One Add per card, one tap.
 */
import React, { useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useQueryClient } from '@tanstack/react-query'
import { exercisesApi, templatesApi, workoutsApi } from '../services/api'
import { colors, radius, spacing } from '../theme'
import type { Equipment, Exercise, MovementPattern, Muscle } from '@fitness/shared-types'

// ---------------------------------------------------------------------------
// Parser — splits content into ordered chunks of markdown text + suggestion JSON.
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

export type Suggestion = ExerciseSuggestion | PlanSuggestion | AddToWorkoutSuggestion

type Chunk =
  | { kind: 'text'; text: string }
  | { kind: 'suggestion'; suggestion: Suggestion; rawIndex: number }

const BLOCK_RE = /```fitness:(exercise|plan|add-to-workout)\s*\n([\s\S]*?)```/g

export function parseTurn(content: string): Chunk[] {
  const chunks: Chunk[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  BLOCK_RE.lastIndex = 0
  while ((m = BLOCK_RE.exec(content)) !== null) {
    if (m.index > cursor) {
      chunks.push({ kind: 'text', text: content.slice(cursor, m.index) })
    }
    try {
      const parsed = JSON.parse(m[2].trim())
      chunks.push({
        kind: 'suggestion',
        suggestion: { kind: m[1] as Suggestion['kind'], data: parsed } as Suggestion,
        rawIndex: m.index,
      })
    } catch {
      // Bad JSON — fall back to rendering the block as plain text so the user
      // can still see something rather than a missing card.
      chunks.push({ kind: 'text', text: m[0] })
    }
    cursor = m.index + m[0].length
  }
  if (cursor < content.length) {
    chunks.push({ kind: 'text', text: content.slice(cursor) })
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

type AddState = 'idle' | 'saving' | 'saved' | 'error'

function CardShell({
  title,
  subtitle,
  addLabel,
  onAdd,
  state,
}: {
  title: string
  subtitle: string
  addLabel: string
  onAdd: () => void
  state: AddState
}) {
  const disabled = state === 'saving' || state === 'saved'
  const btnText =
    state === 'saving' ? '...' : state === 'saved' ? '✓ Added' : addLabel
  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{subtitle}</Text>
      </View>
      <TouchableOpacity
        style={[styles.addBtn, disabled && styles.addBtnDisabled]}
        onPress={onAdd}
        disabled={disabled}
      >
        {state === 'saving' ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.addBtnText}>{btnText}</Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Resolve exercise_name → existing Exercise id (or null if not in library)
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

// ---------------------------------------------------------------------------
// Suggestion renderers
// ---------------------------------------------------------------------------

function ExerciseCard({ s }: { s: ExerciseSuggestion }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AddState>('idle')
  const onAdd = async () => {
    setState('saving')
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
      setState('error')
      Alert.alert('Could not add exercise', 'Try again or add it manually from Library.')
    }
  }
  const subtitle = [
    s.data.primary_muscles.join(', '),
    s.data.movement_pattern,
    s.data.equipment,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <CardShell
      title={s.data.name}
      subtitle={`New exercise · ${subtitle}`}
      addLabel="+ Add to library"
      onAdd={() => void onAdd()}
      state={state}
    />
  )
}

function PlanCard({ s }: { s: PlanSuggestion }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AddState>('idle')
  const onAdd = async () => {
    setState('saving')
    try {
      const resolved = await Promise.all(
        s.data.entries.map(async (e) => ({ e, ex: await resolveExerciseId(e.exercise_name) })),
      )
      const missing = resolved.filter((r) => !r.ex).map((r) => r.e.exercise_name)
      if (missing.length) {
        setState('error')
        Alert.alert(
          'Some exercises not in library',
          `Add these first, then try again: ${missing.join(', ')}`,
        )
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
      setState('error')
      Alert.alert('Could not save plan', 'Try again.')
    }
  }
  const subtitle = `Plan · ${s.data.entries.length} exercise${
    s.data.entries.length === 1 ? '' : 's'
  }`
  const preview = s.data.entries
    .slice(0, 3)
    .map((e) => e.exercise_name)
    .join(', ')
  return (
    <CardShell
      title={s.data.name}
      subtitle={`${subtitle}\n${preview}${s.data.entries.length > 3 ? '...' : ''}`}
      addLabel="+ Save plan"
      onAdd={() => void onAdd()}
      state={state}
    />
  )
}

function AddToWorkoutCard({ s }: { s: AddToWorkoutSuggestion }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AddState>('idle')
  const onAdd = async () => {
    setState('saving')
    try {
      const active = await workoutsApi.active()
      if (!active) {
        setState('error')
        Alert.alert('No active workout', 'Start a workout first, then add this exercise.')
        return
      }
      const ex = await resolveExerciseId(s.data.exercise_name)
      if (!ex) {
        setState('error')
        Alert.alert('Exercise not in library', `Add "${s.data.exercise_name}" to your library first.`)
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
      await workoutsApi.update(active.id, {
        entries: [...active.entries, newEntry],
      })
      void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      setState('saved')
    } catch {
      setState('error')
      Alert.alert('Could not add', 'Try again.')
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
    />
  )
}

// ---------------------------------------------------------------------------
// Public renderer — drop-in replacement for <Markdown>{content}</Markdown>
// ---------------------------------------------------------------------------

export default function CoachContent({
  content,
  mdStyle,
}: {
  content: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdStyle: any
}) {
  const chunks = parseTurn(content)
  return (
    <View>
      {chunks.map((c, i) => {
        if (c.kind === 'text') {
          // Skip pure-whitespace text fragments between cards
          if (!c.text.trim()) return null
          return <Markdown key={i} style={mdStyle}>{c.text}</Markdown>
        }
        const s = c.suggestion
        if (s.kind === 'exercise') return <ExerciseCard key={i} s={s} />
        if (s.kind === 'plan') return <PlanCard key={i} s={s} />
        if (s.kind === 'add-to-workout') return <AddToWorkoutCard key={i} s={s} />
        return null
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardSub: { fontSize: 12, color: colors.gray500, marginTop: 2 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
})
