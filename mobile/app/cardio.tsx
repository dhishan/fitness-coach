/**
 * Cardio screen — full history + quick log form.
 * Mirrors web Cardio.tsx UX: type chips, duration min+sec, distance km,
 * avg HR, calories, notes. Edit/delete via Alert.
 */

import React, { useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CardioLog, CardioLogCreate, CardioLogUpdate, CardioType } from '@fitness/shared-types'
import { cardioApi } from '../src/services/api'
import { colors, spacing, radius, card, shadow } from '../src/theme'
import { toLocalISODate } from '../src/lib/dates'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<CardioType, string> = {
  run: 'Run',
  ride: 'Ride',
  walk: 'Walk',
  swim: 'Swim',
  other: 'Other',
}
const TYPES: CardioType[] = ['run', 'ride', 'walk', 'swim', 'other']

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0 && sec > 0) return `${m}m ${sec}s`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

function formatDistance(m: number): string {
  if (!m) return ''
  return `${(m / 1000).toFixed(2)} km`
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  date: string
  type: CardioType
  mins: string
  secs: string
  distance_km: string
  avg_hr: string
  calories: string
  notes: string
}

const EMPTY_FORM: FormState = {
  date: toLocalISODate(),
  type: 'run',
  mins: '',
  secs: '',
  distance_km: '',
  avg_hr: '',
  calories: '',
  notes: '',
}

function logToForm(log: CardioLog): FormState {
  const m = Math.floor(log.duration_s / 60)
  const s = log.duration_s % 60
  return {
    date: log.date,
    type: log.type,
    mins: String(m),
    secs: s > 0 ? String(s) : '',
    distance_km: log.distance_m > 0 ? String(log.distance_m / 1000) : '',
    avg_hr: log.avg_hr != null ? String(log.avg_hr) : '',
    calories: log.calories != null ? String(log.calories) : '',
    notes: log.notes ?? '',
  }
}

function formToDurationS(f: FormState): number {
  return (parseInt(f.mins || '0', 10)) * 60 + (parseInt(f.secs || '0', 10))
}

// ---------------------------------------------------------------------------
// CardioForm — shared for create and edit (shown in a Modal when editing)
// ---------------------------------------------------------------------------

interface FormProps {
  initial: FormState
  isEdit: boolean
  onSave: (f: FormState) => void
  onCancel: () => void
  saving: boolean
}

function CardioForm({ initial, isEdit, onSave, onCancel, saving }: FormProps) {
  const [form, setForm] = useState<FormState>(initial)
  const set = (key: keyof FormState) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = () => {
    const durationS = formToDurationS(form)
    if (!form.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      Alert.alert('Invalid date', 'Date must be YYYY-MM-DD')
      return
    }
    if (durationS <= 0) {
      Alert.alert('Duration required', 'Enter at least 1 minute.')
      return
    }
    onSave(form)
  }

  return (
    <ScrollView
      contentContainerStyle={s.formContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.sectionTitle}>{isEdit ? 'Edit session' : 'Log cardio session'}</Text>

      {/* Type chips */}
      <Text style={s.fieldLabel}>Type</Text>
      <View style={s.chipRow}>
        {TYPES.map((t) => (
          <Pressable
            key={t}
            style={[s.chip, form.type === t && s.chipActive]}
            onPress={() => setForm((prev) => ({ ...prev, type: t }))}
          >
            <Text style={[s.chipText, form.type === t && s.chipTextActive]}>
              {TYPE_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Date (only for new) */}
      {!isEdit && (
        <>
          <Text style={s.fieldLabel}>Date</Text>
          <TextInput
            style={s.input}
            value={form.date}
            onChangeText={set('date')}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.gray400}
            keyboardType="numbers-and-punctuation"
          />
        </>
      )}

      {/* Duration */}
      <Text style={s.fieldLabel}>Duration *</Text>
      <View style={s.durationRow}>
        <TextInput
          style={[s.input, s.durationInput]}
          value={form.mins}
          onChangeText={set('mins')}
          placeholder="min"
          placeholderTextColor={colors.gray400}
          keyboardType="number-pad"
        />
        <Text style={s.durationSep}>m</Text>
        <TextInput
          style={[s.input, s.durationInput]}
          value={form.secs}
          onChangeText={set('secs')}
          placeholder="sec"
          placeholderTextColor={colors.gray400}
          keyboardType="number-pad"
        />
        <Text style={s.durationSep}>s</Text>
      </View>

      {/* Distance / HR / Calories */}
      <View style={s.row3}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Distance (km)</Text>
          <TextInput
            style={s.input}
            value={form.distance_km}
            onChangeText={set('distance_km')}
            placeholder="optional"
            placeholderTextColor={colors.gray400}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Avg HR (bpm)</Text>
          <TextInput
            style={s.input}
            value={form.avg_hr}
            onChangeText={set('avg_hr')}
            placeholder="optional"
            placeholderTextColor={colors.gray400}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Calories</Text>
          <TextInput
            style={s.input}
            value={form.calories}
            onChangeText={set('calories')}
            placeholder="optional"
            placeholderTextColor={colors.gray400}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {/* Notes */}
      <Text style={s.fieldLabel}>Notes</Text>
      <TextInput
        style={[s.input, { height: 64 }]}
        value={form.notes}
        onChangeText={set('notes')}
        placeholder="Optional notes"
        placeholderTextColor={colors.gray400}
        multiline
      />

      {/* Buttons */}
      <View style={s.btnRow}>
        <Pressable
          style={[s.btnPrimary, saving && s.btnDisabled]}
          onPress={handleSubmit}
          disabled={saving}
        >
          <Text style={s.btnPrimaryText}>{saving ? 'Saving...' : isEdit ? 'Save changes' : 'Save session'}</Text>
        </Pressable>
        <Pressable style={s.btnSecondary} onPress={onCancel}>
          <Text style={s.btnSecondaryText}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CardioScreen() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editLog, setEditLog] = useState<CardioLog | null>(null)

  const { data: logs = [], isLoading } = useQuery<CardioLog[]>({
    queryKey: ['cardio', { limit: 100 }],
    queryFn: () => cardioApi.list({ limit: 100 }),
  })

  const createMutation = useMutation({
    mutationFn: (payload: CardioLogCreate) => cardioApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cardio'] })
      setShowForm(false)
    },
    onError: () => Alert.alert('Error', 'Could not save session'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CardioLogUpdate }) =>
      cardioApi.update(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cardio'] })
      setEditLog(null)
    },
    onError: () => Alert.alert('Error', 'Could not update session'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cardioApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cardio'] }),
    onError: () => Alert.alert('Error', 'Delete failed'),
  })

  const handleCreate = (form: FormState) => {
    const durationS = formToDurationS(form)
    const distM = form.distance_km.trim() ? parseFloat(form.distance_km) * 1000 : 0
    const avgHr = form.avg_hr.trim() ? parseInt(form.avg_hr, 10) : null
    const cals = form.calories.trim() ? parseInt(form.calories, 10) : null
    createMutation.mutate({
      date: form.date,
      type: form.type,
      duration_s: durationS,
      distance_m: distM,
      avg_hr: avgHr,
      calories: cals,
      notes: form.notes,
      source: 'manual',
    })
  }

  const handleUpdate = (form: FormState) => {
    if (!editLog) return
    const durationS = formToDurationS(form)
    const distM = form.distance_km.trim() ? parseFloat(form.distance_km) * 1000 : 0
    const avgHr = form.avg_hr.trim() ? parseInt(form.avg_hr, 10) : null
    const cals = form.calories.trim() ? parseInt(form.calories, 10) : null
    updateMutation.mutate({
      id: editLog.id,
      payload: {
        type: form.type,
        duration_s: durationS,
        distance_m: distM,
        avg_hr: avgHr,
        calories: cals,
        notes: form.notes,
      },
    })
  }

  const confirmDelete = (log: CardioLog) => {
    Alert.alert(
      'Delete session',
      `Delete this ${TYPE_LABELS[log.type]} on ${formatDate(log.date)}?`,
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(log.id),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  return (
    <View style={s.root}>
      {/* Header row */}
      <View style={[card, s.headerCard]}>
        <View style={s.headerRow}>
          <Text style={s.pageTitle}>Cardio</Text>
          <Pressable
            style={s.logBtn}
            onPress={() => { setShowForm(true); setEditLog(null) }}
          >
            <Text style={s.logBtnText}>+ Log session</Text>
          </Pressable>
        </View>
        <Text style={s.subtitle}>Log runs, rides, walks, swims, and more.</Text>
      </View>

      {/* History */}
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.base }} />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={[card, s.emptyCard]}>
              <Text style={s.emptyText}>
                No cardio logged yet. Log a session to start tracking.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[card, s.logCard]}>
              <View style={s.logRow}>
                <View style={{ flex: 1 }}>
                  <View style={s.logHeader}>
                    <Text style={s.logType}>{TYPE_LABELS[item.type]}</Text>
                    <Text style={s.logDate}>{formatDate(item.date)}</Text>
                  </View>
                  <View style={s.logMeta}>
                    <Text style={s.logMetaText}>{formatDuration(item.duration_s)}</Text>
                    {item.distance_m > 0 && (
                      <Text style={s.logMetaText}>{formatDistance(item.distance_m)}</Text>
                    )}
                    {item.avg_hr != null && (
                      <Text style={s.logMetaText}>{item.avg_hr} bpm</Text>
                    )}
                    {item.calories != null && (
                      <Text style={s.logMetaText}>{item.calories} kcal</Text>
                    )}
                  </View>
                  {item.notes ? (
                    <Text style={s.logNotes} numberOfLines={1}>{item.notes}</Text>
                  ) : null}
                </View>
                <View style={s.actionBtns}>
                  <Pressable onPress={() => setEditLog(item)}>
                    <Text style={s.editBtn}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(item)}>
                    <Text style={s.deleteBtn}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {/* Log session modal */}
      <Modal
        visible={showForm && !editLog}
        animationType="slide"
        onRequestClose={() => setShowForm(false)}
      >
        <View style={s.modalRoot}>
          <CardioForm
            initial={EMPTY_FORM}
            isEdit={false}
            onSave={handleCreate}
            onCancel={() => setShowForm(false)}
            saving={createMutation.isPending}
          />
        </View>
      </Modal>

      {/* Edit session modal */}
      <Modal
        visible={!!editLog}
        animationType="slide"
        onRequestClose={() => setEditLog(null)}
      >
        <View style={s.modalRoot}>
          {editLog && (
            <CardioForm
              initial={logToForm(editLog)}
              isEdit
              onSave={handleUpdate}
              onCancel={() => setEditLog(null)}
              saving={updateMutation.isPending}
            />
          )}
        </View>
      </Modal>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  headerCard: {
    margin: spacing.base,
    padding: spacing.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 12, color: colors.gray400, marginTop: 4 },
  logBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  logBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  listContent: { paddingHorizontal: spacing.base, paddingBottom: 32 },

  emptyCard: { padding: spacing.base },
  emptyText: { fontSize: 14, color: colors.gray400 },

  logCard: { padding: spacing.base, marginBottom: spacing.sm },
  logRow: { flexDirection: 'row', alignItems: 'flex-start' },
  logHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  logType: { fontSize: 14, fontWeight: '600', color: colors.text },
  logDate: { fontSize: 12, color: colors.gray400 },
  logMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  logMetaText: { fontSize: 12, color: colors.gray500 },
  logNotes: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  actionBtns: { gap: spacing.sm, alignItems: 'flex-end' },
  editBtn: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  deleteBtn: { fontSize: 12, color: colors.error, fontWeight: '500' },

  // Modal / form
  modalRoot: { flex: 1, backgroundColor: colors.bg },
  formContainer: { padding: spacing.base, gap: spacing.sm, paddingBottom: 48 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  fieldLabel: { fontSize: 12, color: colors.gray500, marginBottom: 4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '500', color: colors.gray600 },
  chipTextActive: { color: '#fff' },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },

  durationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  durationInput: { flex: 1, marginBottom: 0 },
  durationSep: { fontSize: 13, color: colors.gray400, marginRight: spacing.xs },

  row3: { flexDirection: 'row', gap: spacing.sm },

  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.gray600, fontSize: 14, fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },
})
