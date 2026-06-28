import React, { useEffect, useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Exercise, ExerciseHistoryItem, TemplateEntry, WorkoutEntry } from '@fitness/shared-types'
import { templatesApi } from '../../src/services/api'
import { colors, spacing, radius, card } from '../../src/theme'
import { nextSupersetGroup } from '../../src/lib/workoutHelpers'
import { buildEntryFromHistory } from '../../src/lib/addExercise'
import AddExerciseSheet from '../../src/components/AddExerciseSheet'

// ---------------------------------------------------------------------------
// EntryRow (same as new.tsx — kept local to avoid cross-route shared state issues)
// ---------------------------------------------------------------------------

const BADGE_COLORS = ['#a855f7', '#14b8a6', '#f97316', '#ec4899']

function EntryRow({
  entry,
  onUpdate,
  onRemove,
  onToggleSuperset,
}: {
  entry: TemplateEntry
  onUpdate: (e: TemplateEntry) => void
  onRemove: () => void
  onToggleSuperset: () => void
}) {
  const inSuperset = !!entry.superset_group
  const groupNum = entry.superset_group ? Number(entry.superset_group) : 0
  const badgeColor = BADGE_COLORS[(groupNum - 1) % BADGE_COLORS.length] ?? BADGE_COLORS[0]

  const stepSets = (delta: number) => {
    const next = Math.min(20, Math.max(1, entry.target_sets + delta))
    onUpdate({ ...entry, target_sets: next })
  }

  return (
    <View style={[s.entryCard, inSuperset && s.entryCardSuperset]}>
      <View style={s.entryHeader}>
        <View style={s.entryNameRow}>
          <Text style={s.entryName}>{entry.exercise_name}</Text>
          {inSuperset && (
            <View style={[s.ssBadge, { backgroundColor: badgeColor + '22', borderColor: badgeColor }]}>
              <Text style={[s.ssBadgeText, { color: badgeColor }]}>
                SS {entry.superset_group}
              </Text>
            </View>
          )}
        </View>
        <Pressable onPress={onRemove} style={s.removeBtn} hitSlop={8}>
          <Text style={s.removeBtnText}>x</Text>
        </Pressable>
      </View>

      <View style={s.entryControls}>
        <View style={s.setsRow}>
          <Text style={s.setsLabel}>Sets</Text>
          <Pressable style={s.stepBtn} onPress={() => stepSets(-1)} hitSlop={6}>
            <Text style={s.stepBtnText}>-</Text>
          </Pressable>
          <Text style={s.setsValue}>{entry.target_sets}</Text>
          <Pressable style={s.stepBtn} onPress={() => stepSets(1)} hitSlop={6}>
            <Text style={s.stepBtnText}>+</Text>
          </Pressable>
        </View>

        <Pressable
          style={[s.ssBtn, inSuperset && s.ssBtnActive]}
          onPress={onToggleSuperset}
        >
          <Text style={[s.ssBtnText, inSuperset && s.ssBtnTextActive]}>
            {inSuperset ? 'In superset' : 'Superset'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// PlanEditor (edit existing)
// ---------------------------------------------------------------------------

export default function EditPlanScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [entries, setEntries] = useState<TemplateEntry[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: template, isLoading } = useQuery({
    queryKey: ['template', id],
    queryFn: () => templatesApi.get(id!),
    enabled: !!id,
  })

  useEffect(() => {
    if (template) {
      setName(template.name)
      setEntries(template.entries)
    }
  }, [template])

  const handleAdd = (_exercise: Exercise, history: ExerciseHistoryItem[]) => {
    const built = buildEntryFromHistory(_exercise, history)
    const templateEntry: TemplateEntry = {
      exercise_id: built.exercise_id,
      exercise_name: built.exercise_name,
      target_sets: built.sets.filter((s) => !s.is_warmup).length || 3,
      superset_group: null,
    }
    setEntries((prev) => [...prev, templateEntry])
    setShowPicker(false)
  }

  const updateEntry = (index: number, updated: TemplateEntry) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? updated : e)))
  }

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index))
  }

  const toggleSuperset = (index: number) => {
    setEntries((prev) => {
      const entry = prev[index]
      if (entry.superset_group) {
        return prev.map((e, i) => (i === index ? { ...e, superset_group: null } : e))
      }
      const prevEntry = prev[index - 1]
      const group = prevEntry?.superset_group ?? nextSupersetGroup(prev as unknown as WorkoutEntry[])
      return prev.map((e, i) => (i === index ? { ...e, superset_group: group } : e))
    })
  }

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Plan needs a name')
      return
    }
    setSaving(true)
    try {
      await templatesApi.update(id!, { name: name.trim(), entries })
      void qc.invalidateQueries({ queryKey: ['templates'] })
      void qc.invalidateQueries({ queryKey: ['template', id] })
      router.back()
    } catch {
      Alert.alert('Error', 'Could not save plan')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await templatesApi.remove(id!)
      void qc.invalidateQueries({ queryKey: ['templates'] })
      router.back()
    } catch {
      Alert.alert('Error', 'Could not delete plan')
    } finally {
      setDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  return (
    <>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Name */}
        <View style={[card, s.cardPad]}>
          <Text style={s.fieldLabel}>Plan name</Text>
          <TextInput
            style={s.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Push Day, Upper Body..."
            placeholderTextColor={colors.gray400}
            maxLength={80}
          />
        </View>

        {/* Exercises */}
        <View style={[card, s.cardPad]}>
          <View style={s.cardHeader}>
            <Text style={s.sectionTitle}>Exercises</Text>
            <Text style={s.meta}>{entries.length} added</Text>
          </View>

          {entries.length === 0 ? (
            <Text style={s.empty}>No exercises yet. Tap "Add exercise" below.</Text>
          ) : (
            <View style={{ gap: 8, marginTop: spacing.sm }}>
              {entries.map((entry, i) => (
                <EntryRow
                  key={`${entry.exercise_id}-${i}`}
                  entry={entry}
                  onUpdate={(updated) => updateEntry(i, updated)}
                  onRemove={() => removeEntry(i)}
                  onToggleSuperset={() => toggleSuperset(i)}
                />
              ))}
            </View>
          )}

          <Pressable
            style={s.addExBtn}
            onPress={() => {
              Keyboard.dismiss()
              setShowPicker(true)
            }}
          >
            <Text style={s.addExBtnText}>+ Add exercise</Text>
          </Pressable>
        </View>

        {/* Delete */}
        <View style={[card, s.cardPad]}>
          <Pressable
            style={[s.deleteBtn, confirmDelete && s.deleteBtnConfirm]}
            onPress={() => void handleDelete()}
            disabled={deleting}
          >
            <Text style={[s.deleteBtnText, confirmDelete && s.deleteBtnTextConfirm]}>
              {deleting
                ? 'Deleting...'
                : confirmDelete
                ? 'Tap again to confirm delete'
                : 'Delete plan'}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky save */}
      <View style={s.saveBar}>
        <Pressable
          style={[s.saveBtn, (!name.trim() || saving) && s.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={!name.trim() || saving}
        >
          <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save changes'}</Text>
        </Pressable>
      </View>

      <AddExerciseSheet
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onAdd={handleAdd}
      />
    </>
  )
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, gap: spacing.md },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardPad: { padding: spacing.base },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.gray400 },
  empty: { fontSize: 14, color: colors.gray400 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 40,
    fontSize: 14,
    color: colors.text,
  },
  addExBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addExBtnText: { fontSize: 14, fontWeight: '500', color: colors.primary },
  deleteBtn: {
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  deleteBtnConfirm: { backgroundColor: colors.error, borderColor: colors.error },
  deleteBtnText: { fontSize: 14, fontWeight: '600', color: colors.error },
  deleteBtnTextConfirm: { color: '#fff' },
  saveBar: {
    position: 'absolute',
    bottom: 24,
    left: spacing.base,
    right: spacing.base,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Entry card
  entryCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  entryCardSuperset: { borderLeftWidth: 4, borderLeftColor: '#a855f7' },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  entryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  entryName: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  ssBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  ssBadgeText: { fontSize: 11, fontWeight: '500' },
  removeBtn: { padding: 4 },
  removeBtnText: { fontSize: 16, color: colors.gray300, fontWeight: '600' },
  entryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    marginTop: spacing.sm,
  },
  setsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setsLabel: { fontSize: 12, color: colors.gray500 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 18, color: colors.gray600, lineHeight: 22 },
  setsValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    width: 20,
    textAlign: 'center',
  },
  ssBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ssBtnActive: { backgroundColor: '#a855f7', borderColor: '#a855f7' },
  ssBtnText: { fontSize: 12, color: colors.gray500 },
  ssBtnTextActive: { color: '#fff' },
})
