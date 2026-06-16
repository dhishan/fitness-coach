import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Exercise, FinishResponse, SetEntry, Workout, WorkoutEntry, WorkoutTemplate } from '@fitness/shared-types'
import { exercisesApi, templatesApi, workoutsApi } from '../../src/services/api'
import { toLocalISODate } from '../../src/lib/dates'
import { nextSupersetGroup } from '../../src/lib/workoutHelpers'
import { buildEntryFromHistory } from '../../src/lib/addExercise'
import type { EntryWithHistory } from '../../src/lib/addExercise'
import AddExerciseSheet from '../../src/components/AddExerciseSheet'
import SessionIntentModal, { type SessionIntent } from '../../src/components/SessionIntentModal'
import { card, colors, radius, spacing } from '../../src/theme'
import { startFromPlan } from '../../src/lib/startFromPlan'
import { displayToKg, formatWeight, kgToDisplay, stepFor, useWeightUnit } from '../../src/store/units'

// ---------------------------------------------------------------------------
// Autosave hook
// ---------------------------------------------------------------------------

function useAutosave(
  workoutId: string | null,
  entries: WorkoutEntry[],
  enabled: boolean,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const fadeAnim = useRef(new Animated.Value(0)).current

  const showTick = useCallback(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start()
  }, [fadeAnim])

  const save = useCallback(
    async (id: string, e: WorkoutEntry[]) => {
      setSaveState('saving')
      try {
        await workoutsApi.update(id, { entries: e })
        setSaveState('saved')
        showTick()
        setTimeout(() => setSaveState('idle'), 2000)
      } catch {
        setSaveState('error')
        Alert.alert('Autosave failed', 'Retrying...', [], { cancelable: true })
        try {
          await workoutsApi.update(id, { entries: e })
          setSaveState('saved')
          showTick()
          setTimeout(() => setSaveState('idle'), 2000)
        } catch {
          setSaveState('error')
        }
      }
    },
    [showTick],
  )

  useEffect(() => {
    if (!enabled || !workoutId) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void save(workoutId, entries)
    }, 800)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [workoutId, entries, enabled, save])

  return { saveState, fadeAnim }
}

// ---------------------------------------------------------------------------
// Set row
// ---------------------------------------------------------------------------

function SetRow({
  set,
  index,
  onUpdate,
  onRemove,
}: {
  set: SetEntry
  index: number
  onUpdate: (s: SetEntry) => void
  onRemove: () => void
}) {
  const isWarmup = !!set.is_warmup
  const unit = useWeightUnit()
  const weightDisplay = kgToDisplay(set.weight ?? 0, unit)
  const weightStep = stepFor(unit)

  const step = (field: 'weight' | 'reps', delta: number) => {
    if (field === 'weight') {
      const newDisplay = Math.max(0, weightDisplay + delta)
      onUpdate({ ...set, weight: displayToKg(newDisplay, unit) })
      return
    }
    const val = Math.max(0, (set.reps ?? 0) + delta)
    onUpdate({ ...set, reps: val })
  }

  return (
    <View style={[s.setRow, isWarmup && s.setRowWarmup]}>
      {/* Warmup toggle */}
      <View style={s.warmupCol}>
        <Switch
          value={isWarmup}
          onValueChange={(v) => onUpdate({ ...set, is_warmup: v })}
          trackColor={{ false: colors.gray200, true: '#fbbf24' }}
          thumbColor={isWarmup ? '#f59e0b' : colors.gray400}
          style={s.warmupSwitch}
        />
        <Text style={s.warmupLabel}>Warmup</Text>
      </View>

      {/* Weight stepper */}
      <View style={s.stepperGroup}>
        <TouchableOpacity
          onPress={() => step('weight', -weightStep)}
          style={s.stepBtn}
          accessibilityLabel="decrease weight"
        >
          <Text style={s.stepBtnText}>-</Text>
        </TouchableOpacity>
        <TextInput
          style={s.stepInput}
          value={formatWeight(weightDisplay)}
          onChangeText={(t) =>
            onUpdate({ ...set, weight: displayToKg(parseFloat(t) || 0, unit) })
          }
          keyboardType="decimal-pad"
          accessibilityLabel={`set ${index + 1} weight`}
        />
        <TouchableOpacity
          onPress={() => step('weight', weightStep)}
          style={s.stepBtn}
          accessibilityLabel="increase weight"
        >
          <Text style={s.stepBtnText}>+</Text>
        </TouchableOpacity>
        <Text style={s.unit}>{unit}</Text>
      </View>

      {/* Reps stepper */}
      <View style={s.stepperGroup}>
        <TouchableOpacity
          onPress={() => step('reps', -1)}
          style={s.stepBtn}
          accessibilityLabel="decrease reps"
        >
          <Text style={s.stepBtnText}>-</Text>
        </TouchableOpacity>
        <TextInput
          style={s.stepInput}
          value={String(set.reps ?? 0)}
          onChangeText={(t) => onUpdate({ ...set, reps: parseInt(t, 10) || 0 })}
          keyboardType="number-pad"
          accessibilityLabel={`set ${index + 1} reps`}
        />
        <TouchableOpacity
          onPress={() => step('reps', 1)}
          style={s.stepBtn}
          accessibilityLabel="increase reps"
        >
          <Text style={s.stepBtnText}>+</Text>
        </TouchableOpacity>
        <Text style={s.unit}>reps</Text>
      </View>

      {/* RPE */}
      <TextInput
        style={s.rpeInput}
        placeholder="RPE"
        placeholderTextColor={colors.gray400}
        value={set.rpe != null ? String(set.rpe) : ''}
        onChangeText={(t) => onUpdate({ ...set, rpe: t ? parseFloat(t) : null })}
        keyboardType="decimal-pad"
        accessibilityLabel={`set ${index + 1} RPE`}
      />

      {/* Remove */}
      <TouchableOpacity
        onPress={onRemove}
        style={s.removeSetBtn}
        accessibilityLabel="remove set"
      >
        <Text style={s.removeSetText}>x</Text>
      </TouchableOpacity>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Entry card
// ---------------------------------------------------------------------------

function EntryCard({
  entry,
  onUpdate,
  onRemove,
  onAlternatives,
  isInSuperset,
  inSelectMode,
  isSelected,
  onToggleSelect,
}: {
  entry: EntryWithHistory
  onUpdate: (e: WorkoutEntry) => void
  onRemove: () => void
  onAlternatives: () => void
  isInSuperset: boolean
  inSelectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}) {
  const updateSet = (i: number, updated: SetEntry) => {
    const sets = entry.sets.map((x, idx) => (idx === i ? updated : x))
    onUpdate({ ...entry, sets })
  }

  const removeSet = (i: number) => {
    const sets = entry.sets.filter((_, idx) => idx !== i)
    onUpdate({ ...entry, sets })
  }

  const addSet = () => {
    const last = entry.sets[entry.sets.length - 1] ?? { weight: 0, reps: 0 }
    onUpdate({ ...entry, sets: [...entry.sets, { ...last, is_warmup: false }] })
  }

  return (
    <View style={[card, s.entryCard, isInSuperset && s.entryCardSuperset, isSelected && s.entryCardSelected]}>
      {/* Header */}
      <View style={s.entryHeader}>
        <View style={s.entryHeaderLeft}>
          {inSelectMode && (
            <TouchableOpacity
              onPress={onToggleSelect}
              style={[s.selectBox, isSelected && s.selectBoxActive]}
              accessibilityLabel="select entry"
            />
          )}
          <View style={s.entryNameBlock}>
            <Text style={s.entryName} numberOfLines={1}>{entry.exercise_name}</Text>
            {entry.lastTime ? (
              <Text style={s.lastTime}>{entry.lastTime}</Text>
            ) : null}
          </View>
        </View>
        <View style={s.entryHeaderRight}>
          <TouchableOpacity onPress={onAlternatives} style={s.swapBtn}>
            <Text style={s.swapBtnText}>Swap</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onRemove} style={s.removeEntryBtn}>
            <Text style={s.removeEntryText}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sets */}
      <View style={s.setsList}>
        {entry.sets.map((set, i) => (
          <SetRow
            key={i}
            set={set}
            index={i}
            onUpdate={(u) => updateSet(i, u)}
            onRemove={() => removeSet(i)}
          />
        ))}
      </View>

      <TouchableOpacity onPress={addSet} style={s.addSetBtn}>
        <Text style={s.addSetText}>+ Add set</Text>
      </TouchableOpacity>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Alternatives sheet
// ---------------------------------------------------------------------------

function AlternativesSheet({
  exerciseId,
  onClose,
  onSwap,
}: {
  exerciseId: string
  onClose: () => void
  onSwap: (ex: Exercise) => void
}) {
  const { data: alts = [], isLoading } = useQuery({
    queryKey: ['alternatives', exerciseId],
    queryFn: () => exercisesApi.alternatives(exerciseId),
    staleTime: 60_000,
  })

  return (
    <Modal visible animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={s.overlay} onPress={onClose} />
      <View style={s.altSheet}>
        <View style={s.altHeader}>
          <Text style={s.altTitle}>Swap exercise</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} />
        ) : alts.length === 0 ? (
          <Text style={s.emptyText}>No alternatives found.</Text>
        ) : (
          <FlatList
            data={alts}
            keyExtractor={(item) => item.id}
            style={s.altList}
            renderItem={({ item: ex }) => (
              <TouchableOpacity
                style={s.altRow}
                onPress={() => onSwap(ex)}
              >
                <Text style={s.altName}>{ex.name}</Text>
                <View style={s.tagRow}>
                  {ex.primary_muscles.map((m) => (
                    <View key={m} style={s.tag}>
                      <Text style={s.tagText}>{m}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Finish modal
// ---------------------------------------------------------------------------

function FinishModal({
  data,
  startedAt,
  onClose,
}: {
  data: FinishResponse
  startedAt: string | null
  onClose: () => void
}) {
  let duration = ''
  if (startedAt && data.ended_at) {
    const mins = Math.round(
      (new Date(data.ended_at).getTime() - new Date(startedAt).getTime()) / 60_000,
    )
    duration = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`
  }

  return (
    <Modal visible animationType="fade" transparent>
      <View style={s.finishOverlay}>
        <View style={[card, s.finishCard]}>
          <Text style={s.finishTitle}>Workout done!</Text>
          {duration ? <Text style={s.finishDuration}>Duration: {duration}</Text> : null}
          <Text style={s.finishVolume}>
            Total volume: <Text style={s.finishVolumeBold}>{Math.round(data.total_volume).toLocaleString()} kg</Text>
          </Text>
          {data.prs.length > 0 && (
            <View style={s.prsBlock}>
              <Text style={s.prsLabel}>PERSONAL RECORDS</Text>
              {data.prs.map((pr) => (
                <Text key={pr.exercise_id} style={s.prLine}>
                  New PR: {pr.exercise_name} {pr.weight}kg (previous {pr.previous_best}kg)
                </Text>
              ))}
            </View>
          )}
          <TouchableOpacity style={s.finishDoneBtn} onPress={onClose}>
            <Text style={s.finishDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type GroupedEntry =
  | { type: 'single'; entry: EntryWithHistory; originalIndex: number }
  | { type: 'superset'; groupId: string; entries: { entry: EntryWithHistory; originalIndex: number }[] }

function groupEntries(entries: EntryWithHistory[]): GroupedEntry[] {
  const result: GroupedEntry[] = []
  const seenGroups = new Map<string, number>()

  entries.forEach((entry, i) => {
    const g = entry.superset_group
    if (!g) {
      result.push({ type: 'single', entry, originalIndex: i })
    } else {
      const existing = seenGroups.get(g)
      if (existing !== undefined) {
        const group = result[existing] as Extract<GroupedEntry, { type: 'superset' }>
        group.entries.push({ entry, originalIndex: i })
      } else {
        seenGroups.set(g, result.length)
        result.push({ type: 'superset', groupId: g, entries: [{ entry, originalIndex: i }] })
      }
    }
  })

  return result
}

// ---------------------------------------------------------------------------
// Plan chooser modal
// ---------------------------------------------------------------------------

function PlanChooserModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean
  onClose: () => void
  onSelect: (template: WorkoutTemplate) => void
}) {
  const { data: templates = [], isLoading } = useQuery<WorkoutTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    enabled: visible,
  })

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={s.overlay} onPress={onClose} />
      <View style={s.planSheet}>
        <View style={s.planHeader}>
          <Text style={s.planTitle}>Choose a plan</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} />
        ) : templates.length === 0 ? (
          <Text style={s.emptyText}>No plans yet. Create one from Home.</Text>
        ) : (
          <FlatList
            data={templates}
            keyExtractor={(item) => item.id}
            style={s.altList}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.altRow} onPress={() => onSelect(item)}>
                <Text style={s.altName}>{item.name}</Text>
                <Text style={s.planSubText}>{item.entries.length} exercise{item.entries.length !== 1 ? 's' : ''}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  )
}

export default function WorkoutScreen() {
  const router = useRouter()
  const qc = useQueryClient()

  const { data: activeWorkout, isLoading } = useQuery<Workout | null>({
    queryKey: ['workout', 'active'],
    queryFn: () => workoutsApi.active(),
    staleTime: 0,
  })

  const [workout, setWorkout] = useState<Workout | null>(null)
  const [entries, setEntries] = useState<EntryWithHistory[]>([])
  const [starting, setStarting] = useState(false)

  // Sync server -> local state on load AND when a new active session
  // appears OR an external change happens (e.g. Library "Add to current workout")
  useEffect(() => {
    if (activeWorkout === undefined) return
    if (activeWorkout === null) {
      if (workout !== null) {
        setWorkout(null)
        setEntries([])
      }
      return
    }
    // Sync when ID changed (new session) OR when server has more entries
    // than local (external add). Local-only edits in flight are protected by
    // the autosave hook's debounce queueing.
    const idChanged = workout?.id !== activeWorkout.id
    const serverHasMore = activeWorkout.entries.length > entries.length
    if (idChanged || serverHasMore) {
      setWorkout(activeWorkout)
      setEntries(activeWorkout.entries.map((e) => ({ ...e, lastTime: undefined })))
    }
  }, [activeWorkout, workout, entries.length])

  const [showAdd, setShowAdd] = useState(false)
  const [altFor, setAltFor] = useState<number | null>(null)
  const [suggestion, setSuggestion] = useState<import('../../src/services/api').NextExerciseSuggestion | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestAdding, setSuggestAdding] = useState(false)
  const userUnit = useWeightUnit()

  const requestSuggestion = async () => {
    if (!workout) return
    setSuggestLoading(true)
    try {
      const s = await workoutsApi.suggestNext(workout.id)
      setSuggestion(s)
    } catch {
      Alert.alert('Could not suggest', 'Try again in a moment.')
    } finally {
      setSuggestLoading(false)
    }
  }

  const approveSuggestion = async () => {
    if (!workout || !suggestion) return
    setSuggestAdding(true)
    try {
      const hist = await exercisesApi.history(suggestion.exercise_id, 1).catch(() => [])
      const ex = { id: suggestion.exercise_id, name: suggestion.exercise_name } as Exercise
      const built = buildEntryFromHistory(ex, hist, userUnit)
      // Override prefilled sets with the suggested sets/reps if user has no
      // history (otherwise honor what they did last time).
      if (!hist.length) {
        built.sets = Array.from({ length: suggestion.sets }).map(() => ({
          weight: 0,
          reps: suggestion.reps,
          is_warmup: false,
        }))
      }
      setEntries((prev) => [...prev, built])
      setSuggestion(null)
    } finally {
      setSuggestAdding(false)
    }
  }

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [finishing, setFinishing] = useState(false)
  const [finishData, setFinishData] = useState<FinishResponse | null>(null)
  const [planModalVisible, setPlanModalVisible] = useState(false)

  const { saveState, fadeAnim } = useAutosave(workout?.id ?? null, entries, workout !== null)

  const saveLabel =
    saveState === 'saving' ? 'Saving...'
    : saveState === 'saved' ? 'Saved'
    : saveState === 'error' ? 'Save failed'
    : ''

  const [intentModalOpen, setIntentModalOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<WorkoutTemplate | null>(null)

  const showStartChooser = () => {
    Alert.alert(
      'Start workout',
      '',
      [
        {
          text: 'Start blank workout',
          onPress: () => {
            setPendingTemplate(null)
            setIntentModalOpen(true)
          },
        },
        {
          text: 'Start from plan',
          onPress: () => setPlanModalVisible(true),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  const handleStartBlank = async (intent: SessionIntent) => {
    setStarting(true)
    try {
      const w = await workoutsApi.create({
        date: toLocalISODate(),
        intent: intent.goal || intent.energy != null || intent.mental != null || intent.physical != null
          ? intent
          : undefined,
      })
      // Seed the query cache BEFORE setWorkout so the sync useEffect
      // doesn't immediately reset it back to null.
      qc.setQueryData(['workout', 'active'], w)
      setWorkout(w)
      setEntries([])
      setIntentModalOpen(false)
    } catch {
      Alert.alert('Error', 'Could not start workout')
    } finally {
      setStarting(false)
    }
  }

  // Keep handleStart as alias for blank start (used nowhere else now)
  const handleStartFromPlan = async (template: WorkoutTemplate) => {
    setPlanModalVisible(false)
    setPendingTemplate(template)
    setIntentModalOpen(true)
  }

  const handleStartFromPlanWithIntent = async (template: WorkoutTemplate, intent: SessionIntent) => {
    setStarting(true)
    try {
      const hasIntent =
        intent.goal || intent.energy != null || intent.mental != null || intent.physical != null
      const workoutId = await startFromPlan(template, hasIntent ? intent : undefined)
      const w = await workoutsApi.active()
      if (w && w.id === workoutId) {
        qc.setQueryData(['workout', 'active'], w)
        setWorkout(w)
        setEntries(w.entries.map((e) => ({ ...e, lastTime: undefined })))
      } else {
        void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      }
      setIntentModalOpen(false)
      setPendingTemplate(null)
    } catch {
      Alert.alert('Error', 'Could not start workout from plan')
    } finally {
      setStarting(false)
    }
  }

  const handleIntentStart = (intent: SessionIntent) => {
    if (pendingTemplate) {
      void handleStartFromPlanWithIntent(pendingTemplate, intent)
    } else {
      void handleStartBlank(intent)
    }
  }

  const handleAddExercise = async (exercise: Exercise, hist: import('@fitness/shared-types').ExerciseHistoryItem[]) => {
    setShowAdd(false)
    if (!workout) return
    const newEntry = buildEntryFromHistory(exercise, hist, userUnit)
    setEntries((prev) => [...prev, newEntry])
  }

  const handleUpdateEntry = (i: number, updated: WorkoutEntry) => {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...updated } : e)))
  }

  const handleRemoveEntry = (i: number) => {
    setEntries((prev) => prev.filter((_, idx) => idx !== i))
    // Surgically drop the removed entry from the cached active workout so the
    // next sync useEffect doesn't see "server has more" and re-add it before
    // autosave finishes its PUT.
    qc.setQueryData<Workout | null>(['workout', 'active'], (old) => {
      if (!old) return old
      return { ...old, entries: old.entries.filter((_, idx) => idx !== i) }
    })
  }

  const handleSwapExercise = (i: number, ex: Exercise) => {
    setEntries((prev) =>
      prev.map((e, idx) =>
        idx === i ? { ...e, exercise_id: ex.id, exercise_name: ex.name } : e,
      ),
    )
    setAltFor(null)
  }

  const handleGroup = () => {
    if (selected.size < 2) {
      Alert.alert('', 'Select at least 2 exercises to group')
      return
    }
    const group = nextSupersetGroup(entries)
    setEntries((prev) =>
      prev.map((e, i) => (selected.has(i) ? { ...e, superset_group: group } : e)),
    )
    setSelected(new Set())
    setSelectMode(false)
  }

  const handleUngroup = () => {
    setEntries((prev) =>
      prev.map((e, i) => (selected.has(i) ? { ...e, superset_group: null } : e)),
    )
    setSelected(new Set())
    setSelectMode(false)
  }

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const handleFinishConfirm = () => {
    Alert.alert('Finish workout?', 'Are you sure you want to finish?', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', style: 'default', onPress: () => void handleFinish() },
    ])
  }

  const handleFinish = async () => {
    if (!workout) return
    setFinishing(true)
    try {
      const result = await workoutsApi.finish(workout.id)
      setFinishData(result)
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.setQueryData(
        ['workouts'],
        (old: { pages: { items: Workout[]; total: number }[]; pageParams: number[] } | undefined) => {
          if (!old || old.pages.length === 0) return old
          const { prs: _prs, ...finished } = result
          const exists = old.pages.some((p) => p.items.some((w) => w.id === finished.id))
          return {
            ...old,
            pages: old.pages.map((p, idx) => {
              if (exists) {
                return { ...p, items: p.items.map((w) => (w.id === finished.id ? finished : w)) }
              }
              return {
                ...p,
                items: idx === 0 ? [finished, ...p.items] : p.items,
                total: p.total + 1,
              }
            }),
          }
        },
      )
      // Explicitly clear local + cache so the screen returns to empty
      // state immediately, without waiting on a refetch.
      qc.setQueryData(['workout', 'active'], null)
      setWorkout(null)
      setEntries([])
      // Refresh every cached workouts list: home "Last workout", workout-tab
      // recent list, history month view, history infinite list. Single
      // predicate avoids forgetting one.
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          typeof q.queryKey[0] === 'string' &&
          (q.queryKey[0] === 'workouts' ||
            q.queryKey[0] === 'workouts-list' ||
            q.queryKey[0] === 'workouts-month'),
      })
    } catch {
      Alert.alert('Error', 'Could not finish workout')
    } finally {
      setFinishing(false)
    }
  }

  const handleFinishClose = () => {
    setFinishData(null)
    router.replace('/(tabs)')
  }

  const grouped = groupEntries(entries)

  // Render grouped item for FlatList
  const renderGrouped = (item: GroupedEntry) => {
    if (item.type === 'single') {
      return (
        <EntryCard
          key={item.originalIndex}
          entry={item.entry}
          onUpdate={(u) => handleUpdateEntry(item.originalIndex, u)}
          onRemove={() => handleRemoveEntry(item.originalIndex)}
          onAlternatives={() => setAltFor(item.originalIndex)}
          isInSuperset={false}
          inSelectMode={selectMode}
          isSelected={selected.has(item.originalIndex)}
          onToggleSelect={() => toggleSelect(item.originalIndex)}
        />
      )
    }
    return (
      <View key={item.groupId} style={s.supersetGroup}>
        <View style={s.supersetChipRow}>
          <View style={s.supersetChip}>
            <Text style={s.supersetChipText}>SUPERSET</Text>
          </View>
        </View>
        <View style={s.supersetBracket}>
          {item.entries.map(({ entry, originalIndex }) => (
            <EntryCard
              key={originalIndex}
              entry={entry}
              onUpdate={(u) => handleUpdateEntry(originalIndex, u)}
              onRemove={() => handleRemoveEntry(originalIndex)}
              onAlternatives={() => setAltFor(originalIndex)}
              isInSuperset
              inSelectMode={selectMode}
              isSelected={selected.has(originalIndex)}
              onToggleSelect={() => toggleSelect(originalIndex)}
            />
          ))}
        </View>
      </View>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  // Empty state — show recent workouts + Start button in the corner
  if (!workout) {
    return <EmptyWorkoutScreen
      starting={starting}
      onStart={showStartChooser}
      planModalVisible={planModalVisible}
      onClosePlanModal={() => setPlanModalVisible(false)}
      onSelectPlan={(t) => void handleStartFromPlan(t)}
      intentModalOpen={intentModalOpen}
      onCancelIntent={() => { setIntentModalOpen(false); setPendingTemplate(null) }}
      onIntentStart={handleIntentStart}
    />
  }

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      {/* Top bar */}
      <View style={s.topBar}>
        <View>
          <Text style={s.dateText}>{workout.date}</Text>
          {saveLabel ? (
            <Animated.Text
              style={[
                s.saveLabel,
                saveState === 'error' ? s.saveLabelError : s.saveLabelOk,
                { opacity: fadeAnim },
              ]}
            >
              {saveLabel}
            </Animated.Text>
          ) : null}
        </View>
        <View style={s.topBarRight}>
          {selectMode ? (
            <>
              <TouchableOpacity onPress={handleGroup} style={s.groupBtn}>
                <Text style={s.groupBtnText}>Group</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleUngroup} style={s.ungroupBtn}>
                <Text style={s.ungroupBtnText}>Ungroup</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setSelectMode(false); setSelected(new Set()) }}
                style={s.cancelModeBtn}
              >
                <Text style={s.cancelModeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => setSelectMode(true)}
                style={s.supersetModeBtn}
              >
                <Text style={s.supersetModeBtnText}>Superset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleFinishConfirm}
                disabled={finishing}
                style={[s.finishBtn, finishing && s.finishBtnDisabled]}
              >
                <Text style={s.finishBtnText}>Finish</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Entry list */}
      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        {grouped.length === 0 && (
          <Text style={s.emptyText}>No exercises yet. Tap "Add exercise" to begin.</Text>
        )}
        {grouped.map((item) => renderGrouped(item))}

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TouchableOpacity
            style={[s.addExerciseBtn, { flex: 1 }]}
            onPress={() => setShowAdd(true)}
          >
            <Text style={s.addExerciseBtnText}>+ Add exercise</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.suggestBtn}
            onPress={() => void requestSuggestion()}
            disabled={suggestLoading}
          >
            <Text style={s.suggestBtnText}>
              {suggestLoading ? '...' : '✨ Suggest'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Suggest-next approve/cancel modal */}
      <Modal
        visible={suggestion !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setSuggestion(null)}
      >
        <View style={s.suggestOverlay}>
          <View style={s.suggestCard}>
            <Text style={s.suggestTitle}>{suggestion?.exercise_name}</Text>
            <Text style={s.suggestMeta}>
              {suggestion?.sets} sets x {suggestion?.reps} reps
              {suggestion?.primary_muscles?.length
                ? ` · ${suggestion?.primary_muscles.join(', ')}`
                : ''}
            </Text>
            {suggestion?.reason ? (
              <Text style={s.suggestReason}>{suggestion.reason}</Text>
            ) : null}
            <View style={s.suggestActions}>
              <TouchableOpacity
                style={s.suggestCancel}
                onPress={() => setSuggestion(null)}
              >
                <Text style={s.suggestCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.suggestApprove}
                onPress={() => void approveSuggestion()}
                disabled={suggestAdding}
              >
                <Text style={s.suggestApproveText}>
                  {suggestAdding ? 'Adding...' : 'Add to workout'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add exercise sheet */}
      <AddExerciseSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={(ex) => {
          setShowAdd(false)
          router.push(`/library/${ex.id}`)
        }}
      />

      {/* Alternatives sheet */}
      {altFor !== null && (
        <AlternativesSheet
          exerciseId={entries[altFor].exercise_id}
          onClose={() => setAltFor(null)}
          onSwap={(ex) => handleSwapExercise(altFor, ex)}
        />
      )}

      {/* Finish modal */}
      {finishData && (
        <FinishModal
          data={finishData}
          startedAt={workout.started_at ?? null}
          onClose={handleFinishClose}
        />
      )}
    </KeyboardAvoidingView>
  )
}

// ---------------------------------------------------------------------------
// EmptyWorkoutScreen — shown when there is no active workout. Has Start in the
// header and a list of recent workouts below.
// ---------------------------------------------------------------------------

function EmptyWorkoutScreen({
  starting,
  onStart,
  planModalVisible,
  onClosePlanModal,
  onSelectPlan,
  intentModalOpen,
  onCancelIntent,
  onIntentStart,
}: {
  starting: boolean
  onStart: () => void
  planModalVisible: boolean
  onClosePlanModal: () => void
  onSelectPlan: (t: WorkoutTemplate) => void
  intentModalOpen: boolean
  onCancelIntent: () => void
  onIntentStart: (intent: SessionIntent) => void
}) {
  const router = useRouter()
  const unit = useWeightUnit()
  const { data, isLoading } = useQuery({
    queryKey: ['workouts', 'recent'],
    queryFn: () => workoutsApi.list({ limit: 20 }),
    staleTime: 60_000,
  })
  const recent = (data?.items ?? []).filter((w) => w.ended_at)

  return (
    <View style={s.screen}>
      <View style={s.emptyHeader}>
        <Text style={s.emptyTitle}>Recent workouts</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TouchableOpacity
            style={s.cardioLinkBtn}
            onPress={() => router.push('/cardio')}
          >
            <Text style={s.cardioLinkBtnText}>Cardio</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.startSmallBtn, starting && s.startBtnDisabled]}
            onPress={onStart}
            disabled={starting}
          >
            <Text style={s.startSmallBtnText}>{starting ? '...' : '+ Start'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : recent.length === 0 ? (
        <Text style={s.emptyListText}>No workouts yet. Tap "Start workout" to begin.</Text>
      ) : (
        <ScrollView contentContainerStyle={s.recentList}>
          {recent.map((w) => (
            <TouchableOpacity
              key={w.id}
              style={s.recentRow}
              onPress={() => router.push(`/history/${w.id}`)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.recentDate}>{w.date}</Text>
                <Text style={s.recentMeta}>
                  {(() => {
                    const exs = w.entries?.length ?? 0
                    const sets = w.entries?.reduce((sum, e) => sum + (e.sets?.length ?? 0), 0) ?? 0
                    const reps = w.entries?.reduce(
                      (sum, e) => sum + (e.sets?.reduce((s, x) => s + (x.reps ?? 0), 0) ?? 0),
                      0,
                    ) ?? 0
                    const parts = [`${exs} exercise${exs === 1 ? '' : 's'}`]
                    if (sets) parts.push(`${sets} sets`)
                    if (w.total_volume) parts.push(`${Math.round(kgToDisplay(w.total_volume, unit))} ${unit}`)
                    else if (reps) parts.push(`${reps} reps`)
                    return parts.join(' · ')
                  })()}
                </Text>
              </View>
              <Text style={s.recentChevron}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <PlanChooserModal
        visible={planModalVisible}
        onClose={onClosePlanModal}
        onSelect={onSelectPlan}
      />
      <SessionIntentModal
        visible={intentModalOpen}
        starting={starting}
        onCancel={onCancelIntent}
        onStart={onIntentStart}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.base,
  },
  startBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  startBtnDisabled: { opacity: 0.5 },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateText: { fontSize: 12, color: colors.gray400 },
  saveLabel: { fontSize: 11, marginTop: 2 },
  saveLabelOk: { color: colors.success },
  saveLabelError: { color: colors.error },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupBtn: {
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  groupBtnText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  ungroupBtn: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ungroupBtnText: { fontSize: 12, fontWeight: '600', color: colors.gray500 },
  cancelModeBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  cancelModeBtnText: { fontSize: 12, color: colors.gray400 },
  supersetModeBtn: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  supersetModeBtnText: { fontSize: 12, fontWeight: '500', color: colors.gray500 },
  finishBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  finishBtnDisabled: { opacity: 0.5 },
  finishBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // List
  list: { flex: 1 },
  listContent: { padding: spacing.base, paddingBottom: spacing.xl },
  emptyText: { textAlign: 'center', color: colors.gray400, fontSize: 14, paddingVertical: spacing.xl },

  // Entry card
  entryCard: {
    padding: spacing.base,
    marginBottom: 8,
  },
  entryCardSuperset: {
    // bracket applied by parent wrapper
  },
  entryCardSelected: {
    borderColor: colors.primaryLight,
    borderWidth: 2,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  entryHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  entryNameBlock: { flex: 1, minWidth: 0 },
  entryName: { fontSize: 14, fontWeight: '600', color: colors.text },
  lastTime: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  entryHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  swapBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  swapBtnText: { fontSize: 12, fontWeight: '500', color: colors.primary },
  removeEntryBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  removeEntryText: { fontSize: 12, color: colors.gray400 },
  selectBox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: 4,
  },
  selectBoxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  setsList: { gap: 0 },
  addSetBtn: { marginTop: 8 },
  addSetText: { fontSize: 12, fontWeight: '500', color: colors.primary },

  // Set row
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  setRowWarmup: { opacity: 0.6 },
  warmupSwitch: { transform: [{ scaleX: 0.65 }, { scaleY: 0.65 }] },
  warmupCol: { alignItems: 'center', width: 42 },
  warmupLabel: { fontSize: 9, color: colors.gray500, marginTop: -2 },
  emptyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  startSmallBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  startSmallBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  cardioLinkBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  cardioLinkBtnText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  emptyListText: {
    textAlign: 'center',
    marginTop: spacing.xl,
    color: colors.gray500,
    fontSize: 14,
    paddingHorizontal: spacing.lg,
  },
  recentList: { padding: spacing.base, gap: spacing.sm },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentDate: { fontSize: 14, fontWeight: '600', color: colors.text },
  recentMeta: { fontSize: 12, color: colors.gray500, marginTop: 2 },
  recentChevron: { fontSize: 22, color: colors.gray400 },
  stepperGroup: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  stepBtn: {
    width: 24,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 14, color: colors.gray600, lineHeight: 18 },
  stepInput: {
    width: 38,
    height: 28,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    fontSize: 12,
    color: colors.text,
    paddingHorizontal: 0,
  },
  unit: { fontSize: 9, color: colors.gray400, marginLeft: 1 },
  rpeInput: {
    width: 36,
    height: 28,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    fontSize: 10,
    color: colors.textSecondary,
    paddingHorizontal: 0,
  },
  removeSetBtn: { marginLeft: 'auto' },
  removeSetText: { fontSize: 16, color: colors.gray300 },

  // Superset
  supersetGroup: { marginBottom: 8 },
  supersetChipRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, paddingHorizontal: 4 },
  supersetChip: {
    backgroundColor: '#eff6ff',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  supersetChipText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  supersetBracket: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 8,
  },

  // Add exercise button
  addExerciseBtn: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  addExerciseBtnText: { fontSize: 14, fontWeight: '500', color: colors.gray400 },
  suggestBtn: {
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  suggestOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  suggestCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  suggestTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  suggestMeta: { fontSize: 13, color: colors.gray500, marginTop: 4 },
  suggestReason: {
    fontSize: 14,
    color: colors.text,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  suggestActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  suggestCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  suggestCancelText: { color: colors.text, fontSize: 14, fontWeight: '500' },
  suggestApprove: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  suggestApproveText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Plan chooser sheet
  planSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  planTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  planSubText: { fontSize: 12, color: colors.gray400, marginTop: 2 },

  // Alternatives sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  altSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  altHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  altTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cancelText: { fontSize: 14, color: colors.textSecondary },
  altList: { flex: 1 },
  altRow: {
    paddingHorizontal: spacing.base,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray50,
  },
  altName: { fontSize: 14, fontWeight: '500', color: colors.text },
  tagRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.gray100,
  },
  tagText: { fontSize: 11, color: colors.gray500, textTransform: 'capitalize' },

  // Finish modal
  finishOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.base,
  },
  finishCard: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.lg,
  },
  finishTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 4 },
  finishDuration: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
  finishVolume: { fontSize: 14, color: colors.gray700, marginBottom: spacing.base },
  finishVolumeBold: { fontWeight: '700' },
  prsBlock: { marginBottom: spacing.base },
  prsLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gray500,
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  prLine: { fontSize: 13, color: colors.gray800, marginBottom: 2 },
  finishDoneBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  finishDoneBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
