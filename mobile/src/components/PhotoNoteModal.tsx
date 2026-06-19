/**
 * PhotoNoteModal — shown after a meal photo is picked, before estimation.
 *
 * Lets the user add an optional free-text note (portion size, cooking
 * method, hidden ingredients) that rides along to the vision model as a
 * hint. "Estimate" proceeds with whatever was typed (empty is fine);
 * "Cancel" aborts without estimating.
 */
import { useEffect, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { colors, radius, spacing } from '../theme'

export default function PhotoNoteModal({
  visible,
  imageUri,
  onSubmit,
  onCancel,
}: {
  visible: boolean
  imageUri: string | null
  onSubmit: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')

  // Clear the field each time a fresh photo opens the modal
  useEffect(() => {
    if (visible) setNote('')
  }, [visible])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={st.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={st.card}>
          <Text style={st.title}>Add a note</Text>
          <Text style={st.sub}>
            Optional — anything the photo can&apos;t show: portion size, cooking method,
            or hidden ingredients.
          </Text>

          {imageUri ? (
            <Image source={{ uri: imageUri }} style={st.preview} resizeMode="cover" />
          ) : null}

          <TextInput
            style={st.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. large bowl, cooked in ghee, 2 rotis"
            placeholderTextColor={colors.gray400}
            multiline
            autoFocus
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => onSubmit(note.trim())}
          />

          <Pressable style={st.primary} onPress={() => onSubmit(note.trim())}>
            <Text style={st.primaryText}>Estimate</Text>
          </Pressable>
          <Pressable style={st.secondary} onPress={onCancel}>
            <Text style={st.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.base,
    paddingBottom: 32,
    gap: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.gray500, lineHeight: 18 },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.gray100,
    marginVertical: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 64,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', paddingVertical: spacing.sm },
  secondaryText: { fontSize: 14, color: colors.gray500 },
})
