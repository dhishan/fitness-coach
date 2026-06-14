import React, { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Equipment,
  Exercise,
  ExerciseCreate,
  ExerciseHistoryItem,
  Muscle,
  MovementPattern,
} from '@fitness/shared-types'
import { exercisesApi } from '../services/api'
import { colors, spacing, radius, card } from '../theme'

const MUSCLE_OPTIONS: Muscle[] = [
  'chest', 'back', 'quads', 'hamstrings', 'glutes',
  'shoulders', 'biceps', 'triceps', 'core', 'calves', 'forearms',
]

const MOVEMENT_PATTERN_OPTIONS: MovementPattern[] = ['push', 'pull', 'squat', 'hinge', 'carry', 'core']
const EQUIPMENT_OPTIONS: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other']

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

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function CreateExerciseForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string
  onCancel: () => void
  onCreated: (exercise: Exercise) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(initialName)
  const [primaryMuscles, setPrimaryMuscles] = useState<Muscle[]>([])
  const [secondaryMuscles, setSecondaryMuscles] = useState<Muscle[]>([])
  const [pattern, setPattern] = useState<MovementPattern | ''>('')
  const [equipment, setEquipment] = useState<Equipment | ''>('')
  const [saving, setSaving] = useState(false)

  const togglePrimary = (m: Muscle) =>
    setPrimaryMuscles((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))

  const toggleSecondary = (m: Muscle) =>
    setSecondaryMuscles((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))

  const canSave = name.trim().length > 0 && primaryMuscles.length > 0 && pattern !== '' && equipment !== ''

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const body: ExerciseCreate = {
        name: name.trim(),
        primary_muscles: primaryMuscles,
        secondary_muscles: secondaryMuscles,
        movement_pattern: pattern as MovementPattern,
        equipment: equipment as Equipment,
      }
      const created = await exercisesApi.create(body)
      void qc.invalidateQueries({ queryKey: ['exercises'] })
      onCreated(created)
    } catch {
      Alert.alert('Error', 'Could not create exercise')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={s.createScroll} contentContainerStyle={s.createContent}>
      <Text style={s.fieldLabel}>Name</Text>
      <TextInput
        style={s.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Romanian Deadlift"
        placeholderTextColor={colors.gray400}
        autoFocus
      />

      <Text style={s.fieldLabel}>Primary muscles *</Text>
      <View style={s.chipRow}>
        {MUSCLE_OPTIONS.map((m) => {
          const active = primaryMuscles.includes(m)
          const col = MUSCLE_COLORS[m] ?? '#9ca3af'
          return (
            <Pressable
              key={m}
              onPress={() => togglePrimary(m)}
              style={[s.chip, active ? { backgroundColor: col, borderColor: col } : s.chipInactive]}
            >
              <Text style={[s.chipText, active ? s.chipTextActive : s.chipTextInactive]}>
                {m}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={s.fieldLabel}>Secondary muscles (optional)</Text>
      <View style={s.chipRow}>
        {MUSCLE_OPTIONS.map((m) => {
          const active = secondaryMuscles.includes(m)
          const col = MUSCLE_COLORS[m] ?? '#9ca3af'
          return (
            <Pressable
              key={m}
              onPress={() => toggleSecondary(m)}
              style={[s.chip, active ? { backgroundColor: col, borderColor: col, opacity: 0.75 } : s.chipInactive]}
            >
              <Text style={[s.chipText, active ? s.chipTextActive : s.chipTextInactive]}>
                {m}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={s.fieldLabel}>Movement pattern *</Text>
      <View style={s.chipRow}>
        {MOVEMENT_PATTERN_OPTIONS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPattern(p)}
            style={[s.chip, pattern === p ? s.chipPrimary : s.chipInactive]}
          >
            <Text style={[s.chipText, pattern === p ? s.chipTextActive : s.chipTextInactive]}>
              {p}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.fieldLabel}>Equipment *</Text>
      <View style={s.chipRow}>
        {EQUIPMENT_OPTIONS.map((eq) => (
          <Pressable
            key={eq}
            onPress={() => setEquipment(eq)}
            style={[s.chip, equipment === eq ? s.chipPrimary : s.chipInactive]}
          >
            <Text style={[s.chipText, equipment === eq ? s.chipTextActive : s.chipTextInactive]}>
              {eq}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={s.createBtns}>
        <Pressable style={s.btnSecondary} onPress={onCancel}>
          <Text style={s.btnSecondaryText}>Back</Text>
        </Pressable>
        <Pressable
          style={[s.btnPrimary, (!canSave || saving) && s.btnDisabled]}
          onPress={() => void handleSave()}
          disabled={!canSave || saving}
        >
          <Text style={s.btnPrimaryText}>{saving ? 'Saving...' : 'Save exercise'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export default function AddExerciseSheet({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean
  onClose: () => void
  onAdd: (exercise: Exercise, history: ExerciseHistoryItem[]) => void
}) {
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | ''>('')
  const [showCreate, setShowCreate] = useState(false)

  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['exercises', q, muscle],
    queryFn: () => exercisesApi.list({ ...(q ? { q } : {}), ...(muscle ? { muscle } : {}) }),
    staleTime: 60_000,
  })

  const handlePick = async (ex: Exercise) => {
    try {
      const hist = await exercisesApi.history(ex.id, 1)
      onAdd(ex, hist)
    } catch {
      onAdd(ex, [])
    }
  }

  const handleCreated = async (ex: Exercise) => {
    try {
      const hist = await exercisesApi.history(ex.id, 1)
      onAdd(ex, hist)
    } catch {
      onAdd(ex, [])
    }
  }

  const handleClose = () => {
    setQ('')
    setMuscle('')
    setShowCreate(false)
    onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={s.overlay} onPress={handleClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
        {/* Header */}
        <View style={s.sheetHeader}>
          {showCreate ? (
            <Text style={s.sheetTitle}>New custom exercise</Text>
          ) : (
            <TextInput
              style={s.searchInput}
              value={q}
              onChangeText={setQ}
              placeholder="Search exercises..."
              placeholderTextColor={colors.gray400}
              autoFocus
            />
          )}
          <Pressable onPress={handleClose} style={s.cancelBtn}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        {/* Muscle chips */}
        {!showCreate && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={s.chipScrollContent}>
            <Pressable
              onPress={() => setMuscle('')}
              style={[s.chip, muscle === '' ? s.chipPrimary : s.chipInactive]}
            >
              <Text style={[s.chipText, muscle === '' ? s.chipTextActive : s.chipTextInactive]}>
                All
              </Text>
            </Pressable>
            {MUSCLE_OPTIONS.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMuscle(muscle === m ? '' : m)}
                style={[s.chip, muscle === m ? s.chipPrimary : s.chipInactive]}
              >
                <Text style={[s.chipText, muscle === m ? s.chipTextActive : s.chipTextInactive]}>
                  {m}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Content */}
        {showCreate ? (
          <CreateExerciseForm
            initialName={q}
            onCancel={() => setShowCreate(false)}
            onCreated={(ex) => void handleCreated(ex)}
          />
        ) : (
          <FlatList
            data={exercises}
            keyExtractor={(item) => item.id}
            style={s.list}
            ListEmptyComponent={
              isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
              ) : q.trim().length > 0 ? (
                <Text style={s.emptyText}>No exercises match "{q}".</Text>
              ) : null
            }
            ListFooterComponent={
              <Pressable style={s.createRow} onPress={() => setShowCreate(true)}>
                <Text style={s.createRowText}>+ Create custom exercise</Text>
              </Pressable>
            }
            renderItem={({ item: ex }) => (
              <Pressable
                style={s.exerciseRow}
                onPress={() => void handlePick(ex)}
              >
                <Text style={s.exerciseName}>{ex.name}</Text>
                <View style={s.tagRow}>
                  {ex.primary_muscles.map((m) => (
                    <View key={m} style={s.tag}>
                      <Text style={s.tagText}>{m}</Text>
                    </View>
                  ))}
                  <View style={s.tagEquip}>
                    <Text style={s.tagEquipText}>{ex.equipment}</Text>
                  </View>
                </View>
              </Pressable>
            )}
          />
        )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 40,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  cancelBtn: { paddingHorizontal: spacing.sm },
  cancelText: { fontSize: 14, color: colors.textSecondary },
  chipScroll: { maxHeight: 42 },
  chipScrollContent: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.gray200,
  },
  chipText: { fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  chipTextInactive: { color: colors.gray600 },
  list: { flex: 1 },
  exerciseRow: {
    paddingHorizontal: spacing.base,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray50,
  },
  exerciseName: { fontSize: 14, fontWeight: '500', color: colors.text },
  tagRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.gray100,
  },
  tagText: { fontSize: 11, color: colors.gray500, textTransform: 'capitalize' },
  tagEquip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.gray50,
  },
  tagEquipText: { fontSize: 11, color: colors.gray400 },
  emptyText: {
    textAlign: 'center',
    marginTop: spacing.lg,
    fontSize: 14,
    color: colors.gray400,
  },
  createRow: {
    margin: spacing.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  createRowText: { fontSize: 14, fontWeight: '500', color: colors.primary },
  // Create form
  createScroll: { flex: 1 },
  createContent: { padding: spacing.base, gap: spacing.base, paddingBottom: 32 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 40,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  createBtns: { flexDirection: 'row', gap: 12, marginTop: spacing.sm },
  btnSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnSecondaryText: { fontSize: 14, color: colors.gray600 },
  btnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  btnDisabled: { opacity: 0.4 },
})
