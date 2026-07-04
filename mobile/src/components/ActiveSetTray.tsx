// Docked bottom editor for the selected set.
// Big steppers for thumb entry, plus tappable numeric fields that open the
// keypad for granular values (e.g. 102.5). RPE shows as an "Add RPE" pill
// until tapped (Task 8), then a full slider + clear button. Sits above the
// keyboard.

import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import Slider from '@react-native-community/slider'
import { Ionicons } from '@expo/vector-icons'
import type { SetEntry } from '@fitness/shared-types'
import { formatDuration } from '../lib/workoutHelpers'
import { colors, radius, spacing } from '../theme'
import { displayToKg, kgToDisplay, stepFor } from '../store/units'
import { useDecimalText } from '../lib/useDecimalText'

export function ActiveSetTray({
  entryName,
  set,
  setIndex,
  setCount,
  unit,
  tracking,
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
  tracking: 'reps' | 'time'
  keyboardHeight: number
  safeBottom: number
  onUpdate: (s: SetEntry) => void
  onLogNext: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const isTime = tracking === 'time'
  const weightDisplay = kgToDisplay(set.weight ?? 0, unit)
  const weightStep = stepFor(unit)

  // Local text state so the duration field value doesn't reformat under
  // the user's fingers on every keystroke. Committed on blur/endEditing;
  // stepper presses bypass it by setting null immediately.
  const [durText, setDurText] = useState<string | null>(null)

  const stepWeight = (delta: number) => {
    const next = Math.max(0, Math.round((weightDisplay + delta) * 100) / 100)
    onUpdate({ ...set, weight: displayToKg(next, unit) })
  }
  const stepReps = (delta: number) => {
    onUpdate({ ...set, reps: Math.max(0, (set.reps ?? 0) + delta) })
  }
  const stepDuration = (delta: number) => {
    setDurText(null) // discard any draft so the committed value shows
    onUpdate({ ...set, duration_s: Math.max(0, (set.duration_s ?? 0) + delta) })
  }

  // Weight field needs decimal support (2.5, 102.5); the hook holds the raw
  // text so a trailing dot survives between keystrokes.
  const weightField = useDecimalText(weightDisplay, (v) => onUpdate({ ...set, weight: displayToKg(v, unit) }))

  const commitDuration = (t: string) => {
    if (t.includes(':')) {
      const parts = t.split(':')
      const mins = parseInt(parts[0] ?? '0', 10) || 0
      const secs = parseInt(parts[1] ?? '0', 10) || 0
      onUpdate({ ...set, duration_s: Math.max(0, mins * 60 + secs) })
    } else {
      onUpdate({ ...set, duration_s: Math.max(0, parseInt(t, 10) || 0) })
    }
  }

  return (
    <View style={[ts.tray, { bottom: keyboardHeight, paddingBottom: keyboardHeight > 0 ? 10 : safeBottom + 10 }]}>
      <TouchableOpacity onPress={onClose} style={ts.trayCollapse} hitSlop={10} accessibilityLabel="hide editor">
        <Ionicons name="chevron-down" size={20} color={colors.gray400} />
      </TouchableOpacity>
      <View style={ts.trayHeader}>
        <Text style={ts.trayName} numberOfLines={1}>{entryName}</Text>
        <Text style={ts.traySetOf}>Set {setIndex + 1} of {setCount}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={10} style={ts.trayRemove}>
          <Text style={ts.trayRemoveText}>Delete set</Text>
        </TouchableOpacity>
      </View>

      <View style={ts.trayFields}>
        {/* Weight */}
        <View style={ts.trayField}>
          <Text style={ts.trayLabel}>{isTime ? `ADDED WEIGHT (${unit})` : `WEIGHT (${unit})`}</Text>
          <View style={ts.trayStepper}>
            <TouchableOpacity style={ts.trayStepBtn} onPress={() => stepWeight(-weightStep)} accessibilityLabel="decrease weight">
              <Text style={ts.trayStepText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={ts.trayInput}
              value={weightField.text}
              onChangeText={weightField.onChangeText}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel="weight"
            />
            <TouchableOpacity style={ts.trayStepBtn} onPress={() => stepWeight(weightStep)} accessibilityLabel="increase weight">
              <Text style={ts.trayStepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Reps or Duration */}
        {isTime ? (
          <View style={ts.trayField}>
            <Text style={ts.trayLabel}>DURATION</Text>
            <View style={ts.trayStepper}>
              <TouchableOpacity style={ts.trayStepBtn} onPress={() => stepDuration(-15)} accessibilityLabel="decrease duration">
                <Text style={ts.trayStepText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={ts.trayInput}
                value={durText ?? formatDuration(set.duration_s ?? 0)}
                onChangeText={setDurText}
                onEndEditing={() => {
                  if (durText === null) return
                  commitDuration(durText)
                  setDurText(null)
                }}
                keyboardType="number-pad"
                selectTextOnFocus
                accessibilityLabel="duration"
              />
              <TouchableOpacity style={ts.trayStepBtn} onPress={() => stepDuration(15)} accessibilityLabel="increase duration">
                <Text style={ts.trayStepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={ts.trayField}>
            <Text style={ts.trayLabel}>REPS</Text>
            <View style={ts.trayStepper}>
              <TouchableOpacity style={ts.trayStepBtn} onPress={() => stepReps(-1)} accessibilityLabel="decrease reps">
                <Text style={ts.trayStepText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={ts.trayInput}
                value={String(set.reps ?? 0)}
                onChangeText={(t) => onUpdate({ ...set, reps: parseInt(t, 10) || 0 })}
                keyboardType="number-pad"
                selectTextOnFocus
                accessibilityLabel="reps"
              />
              <TouchableOpacity style={ts.trayStepBtn} onPress={() => stepReps(1)} accessibilityLabel="increase reps">
                <Text style={ts.trayStepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* RPE — "Add RPE" pill when null, slider + clear when set */}
      <View style={ts.rpeRow}>
        <Text style={ts.rpeRowLabel}>RPE</Text>
        {set.rpe == null ? (
          <TouchableOpacity
            style={[ts.warmupPill, ts.rpeAddPill]}
            onPress={() => onUpdate({ ...set, rpe: 8 })}
          >
            <Text style={[ts.warmupPillText, ts.rpeAddPillText]}>Add RPE</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Slider
              style={ts.rpeSlider}
              minimumValue={0}
              maximumValue={10}
              step={0.5}
              value={set.rpe}
              onValueChange={(v) => onUpdate({ ...set, rpe: Math.round(v * 2) / 2 })}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.gray200}
              thumbTintColor={colors.primary}
            />
            <Text style={ts.rpeValue}>{set.rpe.toFixed(1)}</Text>
            <TouchableOpacity onPress={() => onUpdate({ ...set, rpe: null })} hitSlop={10} style={ts.rpeClear}>
              <Text style={ts.rpeClearText}>✕</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Warmup toggle + Log button */}
      <View style={ts.trayActions}>
        <TouchableOpacity
          style={[ts.warmupPill, set.is_warmup && ts.warmupPillActive]}
          onPress={() => onUpdate({ ...set, is_warmup: !set.is_warmup })}
        >
          <Text style={[ts.warmupPillText, set.is_warmup && ts.warmupPillTextActive]}>
            {set.is_warmup ? '✓ Warmup' : 'Warmup'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={ts.logSetBtn} onPress={onLogNext}>
          <Text style={ts.logSetText}>Log set & next</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const ts = StyleSheet.create({
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
  // "Add RPE" pill — same size as warmupPill but primary-tinted border/text
  rpeAddPill: { borderColor: colors.primaryLight },
  rpeAddPillText: { color: colors.primary },
  logSetBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logSetText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
