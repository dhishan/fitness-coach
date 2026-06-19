/**
 * IngredientLookupSheet — bottom-sheet modal that fills an ingredient row
 * from one of three sources:
 *   - Barcode scan (Open Food Facts → USDA fallback)
 *   - Photo of the Nutrition Facts label (LLM reads it verbatim)
 *   - USDA text search
 *
 * On a successful hit, calls onFill with a patch ready to apply to the
 * ingredient form (name + serving_label + per-serving macros + per-serving
 * micros).
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'
import type { Estimation } from '@fitness/shared-types'
import { nutritionApi, uploadsApi, type IngredientHit } from '../services/api'
import { colors, radius, spacing } from '../theme'
import BarcodeScanner from '../../components/BarcodeScanner'
import type { RecipeIngredient } from '@fitness/shared-types'

type Patch = Partial<RecipeIngredient>

type Tab = 'barcode' | 'photo' | 'search'

export default function IngredientLookupSheet({
  visible,
  onClose,
  onFill,
}: {
  visible: boolean
  onClose: () => void
  onFill: (patch: Patch) => void
}) {
  const [tab, setTab] = useState<Tab>('search')

  const apply = (patch: Patch) => {
    onFill(patch)
    onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={s.overlay}>
          <View style={s.card}>
            <View style={s.header}>
              <Text style={s.title}>Fill ingredient</Text>
              <Pressable onPress={onClose}>
                <Text style={s.close}>Close</Text>
              </Pressable>
            </View>

            <View style={s.tabs}>
              <TabBtn label="Search" icon="search-outline" active={tab === 'search'} onPress={() => setTab('search')} />
              <TabBtn label="Barcode" icon="barcode-outline" active={tab === 'barcode'} onPress={() => setTab('barcode')} />
              <TabBtn label="Label photo" icon="camera-outline" active={tab === 'photo'} onPress={() => setTab('photo')} />
            </View>

            <View style={s.body}>
              {tab === 'search' && <SearchPane onPick={apply} />}
              {tab === 'barcode' && <BarcodePane onPick={apply} />}
              {tab === 'photo' && <PhotoPane onPick={apply} />}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Helper: map an Estimation / IngredientHit → ingredient patch
// ---------------------------------------------------------------------------

function hitToPatch(hit: Estimation | IngredientHit): Patch {
  const macros = hit.macros ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const micros = (hit.micros ?? {}) as Record<string, number>
  return {
    name: hit.name,
    serving_label: hit.serving || '1 serving',
    servings_used: 1,
    calories_per_serving: round1(macros.calories),
    protein_g_per_serving: round1(macros.protein_g),
    carbs_g_per_serving: round1(macros.carbs_g),
    fat_g_per_serving: round1(macros.fat_g),
    fiber_g_per_serving: round1(micros.fiber_g ?? 0),
    sugar_g_per_serving: round1(micros.sugar_g ?? 0),
    sodium_mg_per_serving: round1(micros.sodium_mg ?? 0),
    potassium_mg_per_serving: round1(micros.potassium_mg ?? 0),
    calcium_mg_per_serving: round1(micros.calcium_mg ?? 0),
    iron_mg_per_serving: round1(micros.iron_mg ?? 0),
    vitamin_c_mg_per_serving: round1(micros.vitamin_c_mg ?? 0),
    vitamin_d_mcg_per_serving: round1(micros.vitamin_d_mcg ?? 0),
    saturated_fat_g_per_serving: round1(micros.saturated_fat_g ?? 0),
    cholesterol_mg_per_serving: round1(micros.cholesterol_mg ?? 0),
    usda_fdc_id: (hit as IngredientHit).usda_fdc_id ?? null,
  }
}

function round1(v: number | undefined): number {
  if (!v) return 0
  return Math.round(v * 10) / 10
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchPane({ onPick }: { onPick: (p: Patch) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<IngredientHit[]>([])
  const [loading, setLoading] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [searched, setSearched] = useState(false)

  const run = async () => {
    const query = q.trim()
    if (!query) return
    setLoading(true)
    setSearched(true)
    try {
      const r = await nutritionApi.searchFoods(query)
      setHits(r)
    } catch {
      setHits([])
    } finally {
      setLoading(false)
    }
  }

  const runAI = async () => {
    const query = q.trim()
    if (!query) return
    setEstimating(true)
    try {
      const est = await nutritionApi.estimateText(query)
      onPick(hitToPatch(est))
    } catch {
      Alert.alert('Error', 'Could not estimate. Try rephrasing.')
    } finally {
      setEstimating(false)
    }
  }

  const AIRow = (
    <Pressable style={s.aiRow} onPress={() => void runAI()} disabled={estimating}>
      <View style={{ flex: 1 }}>
        <Text style={s.aiTitle}>
          {estimating ? 'Estimating…' : `Use AI to estimate "${q.trim()}"`}
        </Text>
        <Text style={s.aiSub}>Best for home-cooked dishes or unlisted foods</Text>
      </View>
      {estimating ? (
        <ActivityIndicator color="#0d9488" />
      ) : (
        <Ionicons name="sparkles-outline" size={20} color="#0d9488" />
      )}
    </Pressable>
  )

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder="e.g. chicken breast, greek yogurt"
          placeholderTextColor={colors.gray400}
          value={q}
          onChangeText={setQ}
          returnKeyType="search"
          onSubmitEditing={() => void run()}
        />
        <TouchableOpacity style={s.searchBtn} onPress={() => void run()}>
          <Text style={s.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      ) : hits.length === 0 && searched ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={s.empty}>No matches in our food databases.</Text>
          {q.trim().length > 1 ? AIRow : null}
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {hits.map((h, i) => (
            <Pressable key={i} style={s.hitRow} onPress={() => onPick(hitToPatch(h))}>
              <View style={{ flex: 1 }}>
                <Text style={s.hitName} numberOfLines={2}>{h.name}</Text>
                <Text style={s.hitMeta}>
                  {h.serving} · {Math.round(h.macros.calories)} kcal · {round1(h.macros.protein_g)}g P
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.gray400} />
            </Pressable>
          ))}
          {searched && q.trim().length > 1 ? AIRow : null}
        </ScrollView>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Barcode
// ---------------------------------------------------------------------------

function BarcodePane({ onPick }: { onPick: (p: Patch) => void }) {
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleCode = async (code: string) => {
    setScanning(false)
    setBusy(true)
    try {
      const hit = await nutritionApi.barcode(code)
      onPick(hitToPatch(hit as Estimation))
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        Alert.alert('Not found', "We don't recognize that barcode. Try Photo or Search.")
      } else {
        Alert.alert('Error', 'Could not look up barcode. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: spacing.md, padding: spacing.md }}>
      <Text style={s.help}>
        Scan the barcode on the package. We check Open Food Facts then USDA.
      </Text>
      <TouchableOpacity
        style={s.bigBtn}
        onPress={() => setScanning(true)}
        disabled={busy}
      >
        <Ionicons name="barcode-outline" size={24} color="#fff" />
        <Text style={s.bigBtnText}>{busy ? 'Looking up…' : 'Open scanner'}</Text>
      </TouchableOpacity>

      <BarcodeScanner
        visible={scanning}
        onCancel={() => setScanning(false)}
        onCode={(c) => void handleCode(c)}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Label photo
// ---------------------------------------------------------------------------

function PhotoPane({ onPick }: { onPick: (p: Patch) => void }) {
  const [busy, setBusy] = useState(false)

  const handlePhoto = async (sourceCamera: boolean) => {
    setBusy(true)
    try {
      const result = sourceCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: 'images',
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: 'images',
            quality: 0.8,
          })
      if (result.canceled || !result.assets[0]) {
        setBusy(false)
        return
      }
      const asset = result.assets[0]
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      )
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')
      const putRes = await FileSystem.uploadAsync(signed.upload_url, manipulated.uri, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      })
      if (putRes.status < 200 || putRes.status >= 300) {
        throw new Error(`Upload failed (${putRes.status})`)
      }
      const est = await nutritionApi.estimateLabel(signed.public_url)
      onPick(hitToPatch(est))
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (e as Error)?.message ??
        'Try again.'
      Alert.alert('Could not read label', String(detail))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: spacing.md, padding: spacing.md }}>
      <Text style={s.help}>
        Snap a clear photo of the Nutrition Facts panel. We read the per-serving values
        as printed.
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TouchableOpacity
          style={[s.bigBtn, { flex: 1 }]}
          onPress={() => void handlePhoto(true)}
          disabled={busy}
        >
          <Ionicons name="camera-outline" size={22} color="#fff" />
          <Text style={s.bigBtnText}>{busy ? 'Reading…' : 'Camera'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.bigBtn, s.bigBtnSecondary, { flex: 1 }]}
          onPress={() => void handlePhoto(false)}
          disabled={busy}
        >
          <Ionicons name="image-outline" size={22} color={colors.primary} />
          <Text style={[s.bigBtnText, { color: colors.primary }]}>Photo library</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------

function TabBtn({
  label,
  icon,
  active,
  onPress,
}: {
  label: string
  icon: keyof typeof Ionicons.glyphMap
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[s.tab, active && s.tabActive]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={active ? colors.primary : colors.gray500} />
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  close: { color: colors.gray500, fontSize: 14 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.base,
    gap: 6,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.gray100,
  },
  tabActive: { backgroundColor: '#EBF3FF' },
  tabLabel: { fontSize: 13, color: colors.gray500, fontWeight: '500' },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
  body: { padding: spacing.base },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 40,
    fontSize: 14,
    color: colors.text,
  },
  searchBtn: {
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  hitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  hitName: { fontSize: 14, fontWeight: '600', color: colors.text },
  hitMeta: { fontSize: 12, color: colors.gray500, marginTop: 2, fontVariant: ['tabular-nums'] },
  empty: { color: colors.gray400, fontSize: 14, textAlign: 'center', marginTop: spacing.md },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
    gap: spacing.sm,
  },
  aiTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  aiSub: { fontSize: 12, color: colors.gray500, marginTop: 2 },
  help: { fontSize: 13, color: colors.gray500, lineHeight: 18 },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  bigBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  bigBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
