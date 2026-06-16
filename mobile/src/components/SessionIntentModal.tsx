/**
 * Pre-workout intent modal. Captures optional goal + energy/mental/physical
 * (1–10) so the next-exercise AI suggestion can factor in subjective state.
 *
 * Values are passed forward via onStart. Everything is optional — user can
 * tap Start with nothing filled in.
 */
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native'
import { colors, radius, spacing } from '../theme'

export type SessionIntent = {
  goal: string
  energy: number | null
  mental: number | null
  physical: number | null
}

type Props = {
  visible: boolean
  starting: boolean
  onCancel: () => void
  onStart: (intent: SessionIntent) => void
}

function ScaleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number) => void
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.chipRow}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n)}
            style={[s.chip, value === n && s.chipActive]}
          >
            <Text style={[s.chipText, value === n && s.chipTextActive]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

export default function SessionIntentModal({ visible, starting, onCancel, onStart }: Props) {
  const [goal, setGoal] = useState('')
  const [energy, setEnergy] = useState<number | null>(null)
  const [mental, setMental] = useState<number | null>(null)
  const [physical, setPhysical] = useState<number | null>(null)

  const reset = () => {
    setGoal('')
    setEnergy(null)
    setMental(null)
    setPhysical(null)
  }

  const handleStart = () => {
    onStart({ goal: goal.trim(), energy, mental, physical })
    reset()
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  const handleSkip = () => {
    onStart({ goal: '', energy: null, mental: null, physical: null })
    reset()
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleCancel}>
      <View style={s.overlay}>
        <View style={s.card}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            <Text style={s.title}>How are you feeling?</Text>
            <Text style={s.subtitle}>Tell the coach what to aim for today. All optional.</Text>

            <View style={{ gap: 6 }}>
              <Text style={s.fieldLabel}>Goal (optional)</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. push day, focus on chest"
                placeholderTextColor={colors.gray400}
                value={goal}
                onChangeText={setGoal}
                maxLength={200}
              />
            </View>

            <ScaleRow label="Energy" value={energy} onChange={setEnergy} />
            <ScaleRow label="Mental" value={mental} onChange={setMental} />
            <ScaleRow label="Physical" value={physical} onChange={setPhysical} />
            <Text style={s.scaleHint}>1 = wrecked  ·  10 = ready to PR</Text>
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity style={s.skip} onPress={handleSkip} disabled={starting}>
              <Text style={s.skipText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancel} onPress={handleCancel} disabled={starting}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.start, starting && { opacity: 0.5 }]}
              onPress={handleStart}
              disabled={starting}
            >
              {starting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.startText}>Start</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.gray500, marginTop: -spacing.xs },
  fieldLabel: { fontSize: 12, color: colors.gray500, fontWeight: '600', textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  row: { gap: 6 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    width: 30,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.gray600 },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  scaleHint: { fontSize: 11, color: colors.gray400, fontStyle: 'italic' },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skip: {
    paddingHorizontal: spacing.base,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { color: colors.gray500, fontSize: 14, fontWeight: '500' },
  cancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelText: { color: colors.text, fontSize: 14, fontWeight: '500' },
  start: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  startText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
