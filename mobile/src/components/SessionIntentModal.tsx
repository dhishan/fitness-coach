/**
 * Pre-workout intent modal. Captures optional goal + physical / mental energy
 * sliders (1-10) so the next-exercise AI suggestion can factor in how the user
 * is feeling.
 */
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Slider from '@react-native-community/slider'
import { colors, radius, spacing } from '../theme'

export type SessionIntent = {
  goal: string
  // We preserve `energy` for backwards-compat with the API payload shape but no
  // longer collect it from the user.
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

function ScaleSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowValue}>{value} / 10</Text>
      </View>
      <Slider
        style={{ width: '100%', height: 36 }}
        minimumValue={1}
        maximumValue={10}
        step={1}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.gray200}
        thumbTintColor={colors.primary}
      />
    </View>
  )
}

export default function SessionIntentModal({ visible, starting, onCancel, onStart }: Props) {
  const [goal, setGoal] = useState('')
  const [physical, setPhysical] = useState(5)
  const [mental, setMental] = useState(5)

  const reset = () => {
    setGoal('')
    setPhysical(5)
    setMental(5)
  }

  const collect = (skipped: boolean): SessionIntent => ({
    goal: skipped ? '' : goal.trim(),
    energy: null,
    mental: skipped ? null : mental,
    physical: skipped ? null : physical,
  })

  const handleStart = () => {
    onStart(collect(false))
    reset()
  }

  const handleSkip = () => {
    onStart(collect(true))
    reset()
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleCancel}>
      <View style={s.overlay}>
        <View style={s.card}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <View style={{ gap: 4 }}>
              <Text style={s.title}>How are you feeling?</Text>
              <Text style={s.subtitle}>Tell the coach what to aim for today. All optional.</Text>
            </View>

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

            <ScaleSlider label="Physical energy" value={physical} onChange={setPhysical} />
            <ScaleSlider label="Mental energy" value={mental} onChange={setMental} />
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
  subtitle: { fontSize: 13, color: colors.gray500 },
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
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowValue: { fontSize: 13, color: colors.gray500, fontVariant: ['tabular-nums'] },
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
