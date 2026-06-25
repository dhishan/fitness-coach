/**
 * FavoriteEditSheet — create or edit a saved food (favorite): name, serving,
 * and the four macros. Used from the unified "Saved foods" library.
 *
 * favorite === null -> create mode; otherwise edit mode (with Delete).
 */
import { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { Favorite, Macros } from '@fitness/shared-types'
import { nutritionApi } from '../services/api'
import { colors, radius, spacing } from '../theme'

export default function FavoriteEditSheet({
  visible,
  favorite,
  onClose,
  onSaved,
}: {
  visible: boolean
  favorite: Favorite | null
  onClose: () => void
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!favorite
  const [name, setName] = useState('')
  const [serving, setServing] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setName(favorite?.name ?? '')
    setServing(favorite?.serving ?? '')
    setCalories(favorite ? String(Math.round(favorite.macros.calories)) : '')
    setProtein(favorite ? String(favorite.macros.protein_g) : '')
    setCarbs(favorite ? String(favorite.macros.carbs_g) : '')
    setFat(favorite ? String(favorite.macros.fat_g) : '')
  }, [visible, favorite])

  const canSave = name.trim().length > 0

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        serving: serving.trim(),
        macros: {
          calories: Number(calories) || 0,
          protein_g: Number(protein) || 0,
          carbs_g: Number(carbs) || 0,
          fat_g: Number(fat) || 0,
        } as Macros,
      }
      if (isEdit && favorite) {
        await nutritionApi.favorites.update(favorite.id, body)
      } else {
        await nutritionApi.favorites.create(body)
      }
      void qc.invalidateQueries({ queryKey: ['favorites'] })
      onSaved()
    } catch {
      Alert.alert('Error', 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = () => {
    if (!favorite) return
    Alert.alert('Delete food?', `"${favorite.name}" will be removed from your saved foods.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await nutritionApi.favorites.remove(favorite.id)
            void qc.invalidateQueries({ queryKey: ['favorites'] })
            onSaved()
          } catch {
            Alert.alert('Error', 'Could not delete. Try again.')
          }
        },
      },
    ])
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.card}>
          <View style={st.handle} />
          <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
            <Text style={st.title}>{isEdit ? 'Edit food' : 'New food'}</Text>

            <Field label="Name">
              <TextInput style={st.input} value={name} onChangeText={setName}
                placeholder="e.g. Clover Greek Yoghurt" placeholderTextColor={colors.gray400} autoFocus={!isEdit} />
            </Field>
            <Field label="Serving">
              <TextInput style={st.input} value={serving} onChangeText={setServing}
                placeholder="e.g. 1 cup (150g)" placeholderTextColor={colors.gray400} />
            </Field>

            <View style={st.macroRow}>
              {([
                { label: 'Calories', val: calories, set: setCalories },
                { label: 'Protein g', val: protein, set: setProtein },
                { label: 'Carbs g', val: carbs, set: setCarbs },
                { label: 'Fat g', val: fat, set: setFat },
              ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                <View key={label} style={st.macroField}>
                  <Text style={st.macroLabel}>{label}</Text>
                  <TextInput style={st.macroInput} value={val} onChangeText={set}
                    keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.gray400} selectTextOnFocus />
                </View>
              ))}
            </View>

            <Pressable
              style={[st.primary, (!canSave || saving) && { opacity: 0.5 }]}
              onPress={() => void handleSave()}
              disabled={!canSave || saving}
            >
              <Text style={st.primaryText}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save food'}</Text>
            </Pressable>

            {isEdit ? (
              <Pressable style={st.deleteBtn} onPress={confirmDelete}>
                <Text style={st.deleteText}>Delete food</Text>
              </Pressable>
            ) : null}
            <Pressable style={st.cancelBtn} onPress={onClose}>
              <Text style={st.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4, marginBottom: spacing.md }}>
      <Text style={st.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, maxHeight: '90%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray300, marginTop: 12, marginBottom: 4 },
  content: { padding: spacing.base },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 11, color: colors.gray500, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 42, fontSize: 15, color: colors.text, backgroundColor: colors.surface },
  macroRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md },
  macroField: { width: '47%', gap: 4 },
  macroLabel: { fontSize: 11, color: colors.gray500 },
  macroInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, height: 40, fontSize: 15, color: colors.text, textAlign: 'center', backgroundColor: colors.surface },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: spacing.sm },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  deleteText: { color: colors.error, fontSize: 14, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  cancelText: { color: colors.gray500, fontSize: 14 },
})
