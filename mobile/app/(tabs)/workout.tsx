import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import Slider from '@react-native-community/slider'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Exercise, FinishResponse, SetEntry, Workout, WorkoutEntry, WorkoutTemplate } from '@fitness/shared-types'
import { exercisesApi, templatesApi, workoutsApi } from '../../src/services/api'
import { toLocalISODate } from '../../src/lib/dates'
import { nextSupersetGroup, reorderEntries } from '../../src/lib/workoutHelpers'
import { buildEntryFromHistory } from '../../src/lib/addExercise'
import type { EntryWithHistory } from '../../src/lib/addExercise'
import AddExerciseSheet from '../../src/components/AddExerciseSheet'
import SessionIntentModal, { type SessionIntent } from '../../src/components/SessionIntentModal'
import { track } from '../../src/lib/observability'
import { card, colors, radius, spacing } from '../../src/theme'
import { startFromPlan } from '../../src/lib/startFromPlan'
import { displayToKg, formatWeight, kgToDisplay, stepFor, useWeightUnit } from '../../src/store/units'
import { useDecimalText } from '../../src/lib/useDecimalText'

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
// Set summary row — a compact, readable, tappable line. Editing happens in the
// docked ActiveSetTray, not here, so nothing is cramped and there are no tiny
// inline inputs to mis-tap. Tap a row to make it the active set in the tray.
// ---------------------------------------------------------------------------

function SetSummaryRow({
  set,
  index,
  active,
  unit,
  onPress,
}: {
  set: SetEntry
  index: number
  active: boolean
  unit: 'kg' | 'lb'
  onPress: () => void
}) {
  const isWarmup = !!set.is_warmup
  const weightDisplay = kgToDisplay(set.weight ?? 0, unit)
  return (
    <TouchableOpacity
      style={[s.summaryRow, active && s.summaryRowActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={`set ${index + 1}`}
    >
      <View style={[s.setNumBadge, isWarmup && s.setNumBadgeWarmup, active && s.setNumBadgeActive]}>
        <Text style={[s.setNumText, isWarmup && s.setNumTextWarmup, active && s.setNumTextActive]}>
          {isWarmup ? 'W' : index + 1}
        </Text>
      </View>
      <View style={s.summaryValGroup}>
        <Text style={s.summaryVal}>{formatWeight(weightDisplay)}</Text>
        <Text style={s.summaryUnit}>{unit}</Text>
      </View>
      <Text style={s.summaryTimes}>×</Text>
      <View style={s.summaryValGroup}>
        <Text style={s.summaryVal}>{set.reps ?? 0}</Text>
        <Text style={s.summaryUnit}>reps</Text>
      </View>
      <View style={{ flex: 1 }} />
      {set.rpe != null ? <Text style={s.summaryRpe}>@{set.rpe}</Text> : null}
      {active ? <Text style={s.summaryEditHint}>Editing</Text> : <Text style={s.summaryChevron}>›</Text>}
    </TouchableOpacity>
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
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  unit,
  activeSetIndex,
  onActivateSet,
}: {
  entry: EntryWithHistory
  onUpdate: (e: WorkoutEntry) => void
  onRemove: () => void
  onAlternatives: () => void
  isInSuperset: boolean
  inSelectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  unit: 'kg' | 'lb'
  activeSetIndex: number | null
  onActivateSet: (i: number) => void
}) {
  const router = useRouter()

  const addSet = () => {
    const last = entry.sets[entry.sets.length - 1] ?? { weight: 0, reps: 0 }
    const sets = [...entry.sets, { ...last, is_warmup: false }]
    onUpdate({ ...entry, sets })
    onActivateSet(sets.length - 1)
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
          <Pressable
            style={s.entryNameBlock}
            onPress={() => entry.exercise_id && router.push(`/library/${entry.exercise_id}` as never)}
            disabled={!entry.exercise_id}
          >
            <View style={s.entryNameRow}>
              <Text style={[s.entryName, entry.exercise_id && s.entryNameLink]} numberOfLines={1}>
                {entry.exercise_name}
              </Text>
              {entry.exercise_id ? <Text style={s.entryNameChevron}>›</Text> : null}
            </View>
            {entry.lastTime ? (
              <Text style={s.lastTime}>{entry.lastTime}</Text>
            ) : null}
          </Pressable>
        </View>
        <View style={s.entryHeaderRight}>
          <TouchableOpacity
            onPress={onMoveUp}
            disabled={!canMoveUp}
            style={[s.reorderBtn, !canMoveUp && s.reorderBtnDisabled]}
            hitSlop={8}
            accessibilityLabel="move up"
          >
            <Text style={[s.reorderBtnText, !canMoveUp && s.reorderBtnTextDisabled]}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onMoveDown}
            disabled={!canMoveDown}
            style={[s.reorderBtn, !canMoveDown && s.reorderBtnDisabled]}
            hitSlop={8}
            accessibilityLabel="move down"
          >
            <Text style={[s.reorderBtnText, !canMoveDown && s.reorderBtnTextDisabled]}>↓</Text>
          </TouchableOpacity>
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
        {entry.sets.length === 0 ? (
          <Text style={s.noSets}>No sets yet — tap "+ Add set"</Text>
        ) : (
          entry.sets.map((set, i) => (
            <SetSummaryRow
              key={i}
              set={set}
              index={i}
              unit={unit}
              active={activeSetIndex === i}
              onPress={() => onActivateSet(i)}
            />
          ))
        )}
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
// Active set tray — docked bottom editor for the selected set. Big steppers for
// thumb entry, plus tappable numeric fields that open the keypad for granular
// values (e.g. 102.5). RPE is a chip strip. Sits above the keyboard.
// ---------------------------------------------------------------------------

function ActiveSetTray({
  entryName,
  set,
  setIndex,
  setCount,
  unit,
  keyboardHeight,
  safeBottom,
  onUpdate,
  onLogNext,
  onRemove,
  onClose,
}: {
  entryName: string
  set: SetEntry
  setIndex: number
  setCount: number
  unit: 'kg' | 'lb'
  keyboardHeight: number
  safeBottom: number
  onUpdate: (s: SetEntry) => void
  onLogNext: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const weightDisplay = kgToDisplay(set.weight ?? 0, unit)
  const weightStep = stepFor(unit)

  const stepWeight = (delta: number) => {
    const next = Math.max(0, Math.round((weightDisplay + delta) * 100) / 100)
    onUpdate({ ...set, weight: displayToKg(next, unit) })
  }
  const stepReps = (delta: number) => {
    onUpdate({ ...set, reps: Math.max(0, (set.reps ?? 0) + delta) })
  }
  // Weight needs decimals (2.5, 102.5); hold raw text so the dot survives typing.
  const weightField = useDecimalText(weightDisplay, (v) => onUpdate({ ...set, weight: displayToKg(v, unit) }))

  return (
    <View style={[s.tray, { bottom: keyboardHeight, paddingBottom: keyboardHeight > 0 ? 10 : safeBottom + 10 }]}>
      <TouchableOpacity onPress={onClose} style={s.trayCollapse} hitSlop={10} accessibilityLabel="hide editor">
        <Ionicons name="chevron-down" size={20} color={colors.gray400} />
      </TouchableOpacity>
      <View style={s.trayHeader}>
        <Text style={s.trayName} numberOfLines={1}>{entryName}</Text>
        <Text style={s.traySetOf}>Set {setIndex + 1} of {setCount}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={10} style={s.trayRemove}>
          <Text style={s.trayRemoveText}>Delete set</Text>
        </TouchableOpacity>
      </View>

      <View style={s.trayFields}>
        {/* Weight */}
        <View style={s.trayField}>
          <Text style={s.trayLabel}>WEIGHT ({unit})</Text>
          <View style={s.trayStepper}>
            <TouchableOpacity style={s.trayStepBtn} onPress={() => stepWeight(-weightStep)} accessibilityLabel="decrease weight">
              <Text style={s.trayStepText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={s.trayInput}
              value={weightField.text}
              onChangeText={weightField.onChangeText}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel="weight"
            />
            <TouchableOpacity style={s.trayStepBtn} onPress={() => stepWeight(weightStep)} accessibilityLabel="increase weight">
              <Text style={s.trayStepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Reps */}
        <View style={s.trayField}>
          <Text style={s.trayLabel}>REPS</Text>
          <View style={s.trayStepper}>
            <TouchableOpacity style={s.trayStepBtn} onPress={() => stepReps(-1)} accessibilityLabel="decrease reps">
              <Text style={s.trayStepText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={s.trayInput}
              value={String(set.reps ?? 0)}
              onChangeText={(t) => onUpdate({ ...set, reps: parseInt(t, 10) || 0 })}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel="reps"
            />
            <TouchableOpacity style={s.trayStepBtn} onPress={() => stepReps(1)} accessibilityLabel="increase reps">
              <Text style={s.trayStepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* RPE slider (6-10, half steps) */}
      <View style={s.rpeRow}>
        <Text style={s.rpeRowLabel}>RPE</Text>
        <Slider
          style={s.rpeSlider}
          minimumValue={6}
          maximumValue={10}
          step={0.5}
          value={set.rpe ?? 8}
          onValueChange={(v) => onUpdate({ ...set, rpe: Math.round(v * 2) / 2 })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.gray200}
          thumbTintColor={colors.primary}
        />
        <Text style={s.rpeValue}>{set.rpe != null ? set.rpe.toFixed(1) : '—'}</Text>
        {set.rpe != null && (
          <TouchableOpacity onPress={() => onUpdate({ ...set, rpe: null })} hitSlop={10} style={s.rpeClear}>
            <Text style={s.rpeClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Warmup + Log */}
      <View style={s.trayActions}>
        <TouchableOpacity
          style={[s.warmupPill, set.is_warmup && s.warmupPillActive]}
          onPress={() => onUpdate({ ...set, is_warmup: !set.is_warmup })}
        >
          <Text style={[s.warmupPillText, set.is_warmup && s.warmupPillTextActive]}>
            {set.is_warmup ? '✓ Warmup' : 'Warmup'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.logSetBtn} onPress={onLogNext}>
          <Text style={s.logSetText}>Log set & next</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  const insets = useSafeAreaInsets()

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

  // Active set being edited in the docked tray: { entry index, set index }.
  const [active, setActive] = useState<{ entry: number; set: number } | null>(null)
  const [kbHeight, setKbHeight] = useState(0)

  // Track the keyboard so the tray floats just above it when a field is focused.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const sub1 = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height))
    const sub2 = Keyboard.addListener(hideEvt, () => setKbHeight(0))
    return () => { sub1.remove(); sub2.remove() }
  }, [])

  // null means the tray is intentionally hidden — never auto-reopen it. Only
  // close it if the set it points at was removed (so it can't edit a ghost).
  useEffect(() => {
    if (!active) return
    const setCount = active.entry < entries.length ? entries[active.entry]?.sets.length ?? 0 : 0
    if (active.entry >= entries.length || active.set >= setCount) {
      setActive(null)
    }
  }, [entries, active])

  const updateActiveSet = (updated: SetEntry) => {
    if (!active) return
    const entry = entries[active.entry]
    if (!entry) return
    const sets = entry.sets.map((x, i) => (i === active.set ? updated : x))
    handleUpdateEntry(active.entry, { ...entry, sets })
  }

  const removeActiveSet = () => {
    if (!active) return
    const entry = entries[active.entry]
    if (!entry) return
    const sets = entry.sets.filter((_, i) => i !== active.set)
    handleUpdateEntry(active.entry, { ...entry, sets })
    setActive(sets.length ? { entry: active.entry, set: Math.max(0, active.set - 1) } : null)
  }

  const logSetAndNext = () => {
    if (!active) return
    const entry = entries[active.entry]
    if (!entry) return
    if (active.set < entry.sets.length - 1) {
      setActive({ entry: active.entry, set: active.set + 1 })
    } else {
      const last = entry.sets[active.set] ?? { weight: 0, reps: 0 }
      const sets = [...entry.sets, { ...last, is_warmup: false }]
      handleUpdateEntry(active.entry, { ...entry, sets })
      setActive({ entry: active.entry, set: sets.length - 1 })
    }
    Keyboard.dismiss()
  }

  const activeEntry = active ? entries[active.entry] : null
  const activeSet = activeEntry ? activeEntry.sets[active!.set] : null

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
    setEntries((prev) => {
      setActive({ entry: prev.length, set: 0 }) // open the tray on the new exercise
      return [...prev, newEntry]
    })
  }

  const handleUpdateEntry = (i: number, updated: WorkoutEntry) => {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...updated } : e)))
  }

  const handleMoveEntry = (i: number, direction: -1 | 1) => {
    setEntries((prev) => reorderEntries(prev, i, direction))
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
      track('workout.finished', { entries: entries.length, total_volume: result.total_volume })
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
          canMoveUp={item.originalIndex > 0}
          canMoveDown={item.originalIndex < entries.length - 1}
          onMoveUp={() => handleMoveEntry(item.originalIndex, -1)}
          onMoveDown={() => handleMoveEntry(item.originalIndex, 1)}
          unit={userUnit}
          activeSetIndex={active?.entry === item.originalIndex ? active.set : null}
          onActivateSet={(si) =>
            setActive((prev) =>
              prev?.entry === item.originalIndex && prev?.set === si ? null : { entry: item.originalIndex, set: si },
            )
          }
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
          {item.entries.map(({ entry, originalIndex }, idx) => (
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
              canMoveUp={idx > 0}
              canMoveDown={idx < item.entries.length - 1}
              onMoveUp={() => handleMoveEntry(originalIndex, -1)}
              onMoveDown={() => handleMoveEntry(originalIndex, 1)}
              unit={userUnit}
              activeSetIndex={active?.entry === originalIndex ? active.set : null}
              onActivateSet={(si) =>
                setActive((prev) =>
                  prev?.entry === originalIndex && prev?.set === si ? null : { entry: originalIndex, set: si },
                )
              }
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
      // The set inputs live deep in a ScrollView; iOS keyboard insets on the
      // ScrollView (below) scroll the focused field into view. Adding 'padding'
      // here too would double-adjust, so the ScrollView owns keyboard handling.
      behavior={undefined}
      keyboardVerticalOffset={0}
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
      <ScrollView
        style={s.list}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + (activeSet ? 260 : spacing.xl) }]}
        // Scroll the focused set input above the keyboard, and let taps on
        // other inputs go through without first dismissing the keyboard.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
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

      {/* Docked active-set editor */}
      {activeEntry && activeSet && !selectMode && (
        <ActiveSetTray
          entryName={activeEntry.exercise_name}
          set={activeSet}
          setIndex={active!.set}
          setCount={activeEntry.sets.length}
          unit={userUnit}
          keyboardHeight={kbHeight}
          safeBottom={insets.bottom}
          onUpdate={updateActiveSet}
          onLogNext={logSetAndNext}
          onRemove={removeActiveSet}
          onClose={() => setActive(null)}
        />
      )}

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
        onAdd={(ex, hist) => { void handleAddExercise(ex, hist) }}
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
  listContent: { padding: spacing.base },
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
  entryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  entryName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  entryNameLink: { color: colors.primary },
  entryNameChevron: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  lastTime: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  entryHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  swapBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  swapBtnText: { fontSize: 12, fontWeight: '500', color: colors.primary },
  reorderBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  reorderBtnDisabled: { opacity: 0.25 },
  reorderBtnText: { fontSize: 18, fontWeight: '700', color: colors.gray700, lineHeight: 20 },
  reorderBtnTextDisabled: { color: colors.gray400 },
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
  addSetText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  noSets: { fontSize: 13, color: colors.gray400, paddingVertical: 8 },

  // Set summary row (tap to edit in the tray)
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryRowActive: {
    backgroundColor: '#eff6ff',
    borderBottomColor: 'transparent',
  },
  setNumBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setNumBadgeWarmup: { backgroundColor: '#fef3c7' },
  setNumBadgeActive: { backgroundColor: colors.primary },
  setNumText: { fontSize: 13, fontWeight: '700', color: colors.gray600 },
  setNumTextWarmup: { color: '#b45309' },
  setNumTextActive: { color: '#fff' },
  summaryValGroup: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  summaryVal: { fontSize: 17, fontWeight: '700', color: colors.text },
  summaryUnit: { fontSize: 11, color: colors.gray400 },
  summaryTimes: { fontSize: 13, color: colors.gray400 },
  summaryRpe: { fontSize: 13, fontWeight: '600', color: colors.primary, marginRight: 6 },
  summaryEditHint: { fontSize: 11, fontWeight: '600', color: colors.primary },
  summaryChevron: { fontSize: 18, color: colors.gray300 },

  // Active set tray
  tray: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 12,
  },
  trayHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray200,
    marginBottom: 8,
  },
  trayCollapse: { alignSelf: 'center', paddingVertical: 2, paddingHorizontal: 24, marginBottom: 4 },
  trayHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  trayName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  traySetOf: { fontSize: 12, color: colors.gray500 },
  trayRemove: { paddingHorizontal: 6, paddingVertical: 2 },
  trayRemoveText: { fontSize: 12, color: colors.error, fontWeight: '500' },
  trayFields: { flexDirection: 'row', gap: spacing.md },
  trayField: { flex: 1 },
  trayLabel: { fontSize: 10, fontWeight: '700', color: colors.gray500, letterSpacing: 0.5, marginBottom: 6 },
  trayStepper: { flexDirection: 'row', alignItems: 'center' },
  trayStepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayStepText: { fontSize: 24, color: colors.gray700, lineHeight: 28 },
  trayInput: {
    flex: 1,
    height: 48,
    marginHorizontal: 6,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  rpeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  rpeRowLabel: { fontSize: 10, fontWeight: '700', color: colors.gray500, letterSpacing: 0.5, width: 30 },
  rpeSlider: { flex: 1, height: 40 },
  rpeValue: { fontSize: 16, fontWeight: '700', color: colors.text, width: 36, textAlign: 'right' },
  rpeClear: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  rpeClearText: { fontSize: 13, color: colors.gray400, fontWeight: '600' },
  rpeChips: { gap: 6, paddingRight: 8 },
  rpeChip: {
    minWidth: 44,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rpeChipActive: { backgroundColor: colors.primary },
  rpeChipText: { fontSize: 14, fontWeight: '600', color: colors.gray600 },
  rpeChipTextActive: { color: '#fff' },
  trayActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 12 },
  warmupPill: {
    paddingHorizontal: 14,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warmupPillActive: { backgroundColor: '#fef3c7', borderColor: '#fcd34d' },
  warmupPillText: { fontSize: 13, fontWeight: '600', color: colors.gray500 },
  warmupPillTextActive: { color: '#b45309' },
  logSetBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logSetText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Set row (legacy, retained styles)
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
  removeSetBtn: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeSetText: { fontSize: 15, color: colors.gray400, fontWeight: '600' },

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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 24,
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 24,
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
