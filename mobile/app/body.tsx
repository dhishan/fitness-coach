import React, { useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Alert,
  ActivityIndicator,
  Dimensions,
  Image,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { BodyMetric, BodyMetricCreate } from '@fitness/shared-types'
import { bodyApi, uploadsApi } from '../src/services/api'
import { colors, spacing, radius, card } from '../src/theme'
import { toLocalISODate } from '../src/lib/dates'
import { LineChart } from 'react-native-chart-kit'

const SCREEN_WIDTH = Dimensions.get('window').width

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const today = toLocalISODate()
  if (iso === today) return 'Today'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// WeightChart
// ---------------------------------------------------------------------------

function WeightChart({ metrics }: { metrics: BodyMetric[] }) {
  // Show up to 90 days, sorted date asc for chart display
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2) return null

  const chartWidth = SCREEN_WIDTH - spacing.base * 4
  // Reduce labels to avoid crowding - show at most 6
  const step = Math.ceil(sorted.length / 6)
  const labels = sorted.map((m, i) => (i % step === 0 ? m.date.slice(5) : ''))

  return (
    <LineChart
      data={{
        labels,
        datasets: [{ data: sorted.map((m) => m.weight_kg), color: () => colors.primary, strokeWidth: 2 }],
      }}
      width={chartWidth}
      height={180}
      chartConfig={{
        backgroundGradientFrom: colors.surface,
        backgroundGradientTo: colors.surface,
        decimalPlaces: 1,
        color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
        labelColor: () => colors.gray500,
        propsForDots: { r: '3' },
      }}
      bezier
      style={{ marginTop: spacing.md, borderRadius: radius.md }}
    />
  )
}

// ---------------------------------------------------------------------------
// AddMeasurementForm
// ---------------------------------------------------------------------------

interface FormState {
  weight_kg: string
  body_fat_pct: string
  waist_cm: string
  chest_cm: string
  arm_cm: string
  thigh_cm: string
  notes: string
  photo_urls: string[]
}

const EMPTY_FORM: FormState = {
  weight_kg: '',
  body_fat_pct: '',
  waist_cm: '',
  chest_cm: '',
  arm_cm: '',
  thigh_cm: '',
  notes: '',
  photo_urls: [],
}

function AddMeasurementForm({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient()
  const today = toLocalISODate()
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const set = (field: keyof FormState) => (val: string) =>
    setForm((prev) => ({ ...prev, [field]: val }))

  const handlePickPhoto = () => {
    Alert.alert(
      'Add progress photo',
      '',
      [
        { text: 'Take Photo', onPress: () => { void pickPhoto('camera') } },
        { text: 'Choose from Library', onPress: () => { void pickPhoto('library') } },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  const pickPhoto = async (source: 'camera' | 'library') => {
    let result: ImagePicker.ImagePickerResult

    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Permission required', 'Camera access is needed for progress photos.')
        return
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      })
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Permission required', 'Photo library access is needed for progress photos.')
        return
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      })
    }

    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    setUploading(true)
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      )
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')
      const putRes = await fetch(signed.upload_url, {
        method: 'PUT',
        body: await (await fetch(manipulated.uri)).blob(),
        headers: { 'Content-Type': 'image/jpeg' },
      })
      if (!putRes.ok) throw new Error('Upload failed')
      setForm((prev) => ({ ...prev, photo_urls: [...prev.photo_urls, signed.public_url] }))
    } catch {
      Alert.alert('Error', 'Could not upload photo. Try again.')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    const weight = parseFloat(form.weight_kg)
    if (!form.weight_kg.trim() || isNaN(weight) || weight <= 0) {
      Alert.alert('Weight required', 'Enter a positive weight in kg.')
      return
    }

    const payload: BodyMetricCreate = {
      date: today,
      weight_kg: weight,
    }
    if (form.body_fat_pct.trim()) payload.body_fat_pct = parseFloat(form.body_fat_pct)
    if (form.waist_cm.trim()) payload.waist_cm = parseFloat(form.waist_cm)
    if (form.chest_cm.trim()) payload.chest_cm = parseFloat(form.chest_cm)
    if (form.arm_cm.trim()) payload.arm_cm = parseFloat(form.arm_cm)
    if (form.thigh_cm.trim()) payload.thigh_cm = parseFloat(form.thigh_cm)
    if (form.notes.trim()) payload.notes = form.notes.trim()
    if (form.photo_urls.length > 0) payload.photo_urls = form.photo_urls

    setSaving(true)
    try {
      await bodyApi.create(payload)
      setForm({ ...EMPTY_FORM })
      void qc.invalidateQueries({ queryKey: ['body'] })
      void qc.invalidateQueries({ queryKey: ['body-latest'] })
      onSaved()
    } catch {
      Alert.alert('Error', 'Could not save measurement')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[card, s.cardPad]}>
      <Text style={s.sectionTitle}>Add measurement</Text>

      <Text style={s.fieldLabel}>Weight (kg) *</Text>
      <TextInput
        style={s.input}
        value={form.weight_kg}
        onChangeText={set('weight_kg')}
        placeholder="e.g. 75.5"
        placeholderTextColor={colors.gray400}
        keyboardType="decimal-pad"
      />

      <Text style={s.fieldLabel}>Body fat % (optional)</Text>
      <TextInput
        style={s.input}
        value={form.body_fat_pct}
        onChangeText={set('body_fat_pct')}
        placeholder="e.g. 18.5"
        placeholderTextColor={colors.gray400}
        keyboardType="decimal-pad"
      />

      <View style={s.inlineRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Waist (cm)</Text>
          <TextInput
            style={s.input}
            value={form.waist_cm}
            onChangeText={set('waist_cm')}
            placeholder="78"
            placeholderTextColor={colors.gray400}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Chest (cm)</Text>
          <TextInput
            style={s.input}
            value={form.chest_cm}
            onChangeText={set('chest_cm')}
            placeholder="95"
            placeholderTextColor={colors.gray400}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <View style={s.inlineRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Arm (cm)</Text>
          <TextInput
            style={s.input}
            value={form.arm_cm}
            onChangeText={set('arm_cm')}
            placeholder="35"
            placeholderTextColor={colors.gray400}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Thigh (cm)</Text>
          <TextInput
            style={s.input}
            value={form.thigh_cm}
            onChangeText={set('thigh_cm')}
            placeholder="55"
            placeholderTextColor={colors.gray400}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <Text style={s.fieldLabel}>Notes (optional)</Text>
      <TextInput
        style={[s.input, { height: 56 }]}
        value={form.notes}
        onChangeText={set('notes')}
        placeholder="Feeling good, morning weigh-in..."
        placeholderTextColor={colors.gray400}
        multiline
      />

      <Pressable
        style={[s.photoBtn, uploading && s.btnDisabled]}
        onPress={handlePickPhoto}
        disabled={uploading}
      >
        <Text style={s.photoBtnText}>
          {uploading ? 'Uploading photo...' : `[+] Add progress photo${form.photo_urls.length > 0 ? ` (${form.photo_urls.length})` : ''}`}
        </Text>
      </Pressable>

      {form.photo_urls.length > 0 && (
        <ScrollView horizontal style={{ marginTop: spacing.sm }} showsHorizontalScrollIndicator={false}>
          {form.photo_urls.map((url, i) => (
            <Image key={i} source={{ uri: url }} style={s.photoThumb} />
          ))}
        </ScrollView>
      )}

      <Pressable
        style={[s.saveBtn, saving && s.btnDisabled]}
        onPress={() => { void handleSave() }}
        disabled={saving}
      >
        <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
      </Pressable>
    </View>
  )
}

// ---------------------------------------------------------------------------
// EntryRow
// ---------------------------------------------------------------------------

function EntryRow({ item, onEdit, onDelete }: {
  item: BodyMetric
  onEdit: (item: BodyMetric) => void
  onDelete: (id: string) => void
}) {
  const handleOptions = () => {
    Alert.alert(
      formatDate(item.date),
      `${item.weight_kg} kg`,
      [
        { text: 'Edit', onPress: () => onEdit(item) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete entry',
              'Are you sure? This cannot be undone.',
              [
                { text: 'Delete', style: 'destructive', onPress: () => onDelete(item.id) },
                { text: 'Cancel', style: 'cancel' },
              ],
            )
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  return (
    <Pressable style={s.entryRow} onPress={handleOptions}>
      <View style={{ flex: 1 }}>
        <Text style={s.entryDate}>{formatDate(item.date)}</Text>
        <View style={s.entryMeta}>
          {item.body_fat_pct != null && (
            <Text style={s.entryMetaText}>BF: {item.body_fat_pct}%</Text>
          )}
          {item.waist_cm != null && (
            <Text style={s.entryMetaText}>Waist: {item.waist_cm}cm</Text>
          )}
          {item.photo_urls.length > 0 && (
            <Text style={s.entryMetaText}>[{item.photo_urls.length} photo{item.photo_urls.length !== 1 ? 's' : ''}]</Text>
          )}
        </View>
      </View>
      <Text style={s.entryWeight}>{item.weight_kg} kg</Text>
      <Text style={s.entryDots}>...</Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// EditModal (inline quick edit for weight/notes)
// ---------------------------------------------------------------------------

function EditModal({ item, onClose }: { item: BodyMetric; onClose: () => void }) {
  const qc = useQueryClient()
  const [weight, setWeight] = useState(String(item.weight_kg))
  const [notes, setNotes] = useState(item.notes ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const val = parseFloat(weight)
    if (isNaN(val) || val <= 0) {
      Alert.alert('Invalid weight', 'Enter a positive number.')
      return
    }
    setSaving(true)
    try {
      await bodyApi.update(item.id, { weight_kg: val, notes: notes.trim() || null })
      void qc.invalidateQueries({ queryKey: ['body'] })
      void qc.invalidateQueries({ queryKey: ['body-latest'] })
      onClose()
    } catch {
      Alert.alert('Error', 'Could not update entry')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={s.editOverlay}>
      <View style={s.editSheet}>
        <Text style={s.sectionTitle}>Edit - {formatDate(item.date)}</Text>
        <Text style={s.fieldLabel}>Weight (kg)</Text>
        <TextInput
          style={s.input}
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          autoFocus
        />
        <Text style={s.fieldLabel}>Notes</Text>
        <TextInput
          style={[s.input, { height: 56 }]}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        <View style={s.btnRow}>
          <Pressable
            style={[s.saveBtn, { flex: 1 }, saving && s.btnDisabled]}
            onPress={() => { void handleSave() }}
            disabled={saving}
          >
            <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
          <View style={{ width: spacing.sm }} />
          <Pressable style={[s.cancelBtn, { flex: 1 }]} onPress={onClose}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Body screen
// ---------------------------------------------------------------------------

export default function BodyScreen() {
  const qc = useQueryClient()
  const [editItem, setEditItem] = useState<BodyMetric | null>(null)
  const [showForm, setShowForm] = useState(false)

  const { data: metrics = [], isLoading } = useQuery<BodyMetric[]>({
    queryKey: ['body', { limit: 90 }],
    queryFn: () => bodyApi.list({ limit: 90 }),
  })

  // 30d delta
  let delta30: number | null = null
  if (metrics.length >= 2) {
    const sorted = [...metrics].sort((a, b) => b.date.localeCompare(a.date))
    const latest = sorted[0]
    const cutoff = new Date(latest.date + 'T00:00:00')
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = toLocalISODate(cutoff)
    const ref = sorted.find((m) => m.date <= cutoffStr)
    if (ref) delta30 = latest.weight_kg - ref.weight_kg
  }

  const handleDelete = async (id: string) => {
    try {
      await bodyApi.remove(id)
      void qc.invalidateQueries({ queryKey: ['body'] })
      void qc.invalidateQueries({ queryKey: ['body-latest'] })
    } catch {
      Alert.alert('Error', 'Could not delete entry')
    }
  }

  // Entries sorted date desc for list
  const sortedDesc = [...metrics].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
    <FlatList
      style={s.scroll}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          {/* Header summary */}
          <View style={[card, s.cardPad]}>
            <Text style={s.sectionTitle}>Body metrics</Text>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
            ) : metrics.length === 0 ? (
              <Text style={s.empty}>No weigh-ins yet. Log your weight to track changes.</Text>
            ) : (
              <>
                {delta30 !== null && (
                  <Text style={[s.delta30, delta30 > 0 ? s.deltaUp : s.deltaDown]}>
                    {delta30 > 0 ? '+' : ''}{delta30.toFixed(1)} kg vs 30 days ago
                  </Text>
                )}
                <WeightChart metrics={metrics} />
              </>
            )}
          </View>

          {/* Add form toggle */}
          {!showForm && (
            <Pressable style={[card, s.cardPad, s.addBtn]} onPress={() => setShowForm(true)}>
              <Text style={s.addBtnText}>+ Log measurement</Text>
            </Pressable>
          )}
          {showForm && (
            <AddMeasurementForm onSaved={() => setShowForm(false)} />
          )}

          {sortedDesc.length > 0 && (
            <Text style={s.listHeader}>History</Text>
          )}
        </>
      }
      data={sortedDesc}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={[card, { marginBottom: spacing.sm }]}>
          <EntryRow
            item={item}
            onEdit={(m) => setEditItem(m)}
            onDelete={(id) => { void handleDelete(id) }}
          />
        </View>
      )}
      ListEmptyComponent={
        !isLoading ? null : null
      }
      ListFooterComponent={<View style={{ height: 40 }} />}
      extraData={editItem}
    />
    {editItem && (
      <EditModal item={editItem} onClose={() => setEditItem(null)} />
    )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, gap: spacing.md },
  cardPad: { padding: spacing.base },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  empty: { fontSize: 14, color: colors.gray400, marginTop: spacing.sm },
  fieldLabel: { fontSize: 12, color: colors.gray500, marginBottom: 4, marginTop: spacing.sm },

  // delta
  delta30: { fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
  deltaUp: { color: colors.error },
  deltaDown: { color: colors.success },

  // add button
  addBtn: { alignItems: 'center', paddingVertical: spacing.md },
  addBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },

  // form inputs
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inlineRow: { flexDirection: 'row' },
  photoBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  photoBtnText: { fontSize: 13, color: colors.gray600, fontWeight: '500' },
  photoThumb: { width: 64, height: 64, borderRadius: radius.sm, marginRight: spacing.sm },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  // list header
  listHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },

  // entry row
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.sm,
  },
  entryDate: { fontSize: 14, fontWeight: '500', color: colors.text },
  entryMeta: { flexDirection: 'row', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap' },
  entryMetaText: { fontSize: 11, color: colors.gray400 },
  entryWeight: { fontSize: 16, fontWeight: '700', color: colors.primary },
  entryDots: { fontSize: 18, color: colors.gray400 },

  // edit modal
  editOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
  },
  btnRow: { flexDirection: 'row', marginTop: spacing.sm },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: { color: colors.gray600, fontSize: 14, fontWeight: '500' },
})
