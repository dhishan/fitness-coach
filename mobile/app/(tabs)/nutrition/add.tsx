import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DayLogs, Favorite, FoodLog, MealType, Recipe } from '@fitness/shared-types'
import { nutritionApi, uploadsApi, type IngredientHit } from '../../../src/services/api'
import type { FoodHit } from '../../../src/components/FoodEditSheet'
import FoodEditSheet from '../../../src/components/FoodEditSheet'
import PhotoNoteModal from '../../../src/components/PhotoNoteModal'
import { colors, radius, spacing } from '../../../src/theme'
import { toLocalISODate } from '../../../src/lib/dates'
import BarcodeScanner from '../../../components/BarcodeScanner'

// ---- helpers ----

function defaultMealForHour(): MealType {
  const h = new Date().getHours()
  if (h >= 4 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 15 && h < 18) return 'snack'
  if (h >= 18 && h < 23) return 'dinner'
  return 'snack'
}

function hitToFoodHit(h: IngredientHit): FoodHit {
  return {
    name: h.name,
    serving: h.serving,
    macros: h.macros,
    micros: h.micros ?? null,
    usda_fdc_id: h.usda_fdc_id ?? null,
    data_type: h.data_type,
    source: h.source ?? 'usda',
  }
}

function logToFoodHit(log: FoodLog): FoodHit {
  return {
    name: log.name,
    serving: log.serving,
    macros: log.macros,
    micros: log.micros as Record<string, number> | null,
    usda_fdc_id: log.usda_fdc_id ?? null,
    source: 'recent',
  }
}

function favToFoodHit(fav: Favorite): FoodHit {
  return { name: fav.name, serving: fav.serving, macros: fav.macros, micros: null, source: 'favorite' }
}

function recipeToFoodHit(r: Recipe): FoodHit {
  return {
    name: r.name,
    serving: `1 serving (of ${r.yields_servings})`,
    macros: r.per_serving_macros,
    micros: (r.per_serving_micros as unknown as Record<string, number>) ?? null,
    source: 'recipe',
  }
}

// ---- badge ----

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  ifct: { bg: '#fef3c7', fg: '#b45309', label: 'IFCT' },
  usda: { bg: '#dbeafe', fg: '#2563eb', label: 'USDA' },
  off: { bg: '#ede9fe', fg: '#7c3aed', label: 'OFF' },
  recent: { bg: '#fff7ed', fg: '#ea580c', label: 'Recent' },
  recipe: { bg: '#ecfdf5', fg: '#16a34a', label: 'Recipe' },
  favorite: { bg: '#fef2f2', fg: '#dc2626', label: 'Fav' },
}

function SourceBadge({ source }: { source?: string | null }) {
  const b = SOURCE_BADGE[source?.toLowerCase() ?? '']
  if (!b) return null
  return (
    <View style={[as.badge, { backgroundColor: b.bg }]}>
      <Text style={[as.badgeText, { color: b.fg }]}>{b.label}</Text>
    </View>
  )
}

// ---- row ----

function FoodRow({ hit, onPress }: { hit: FoodHit; onPress: () => void }) {
  return (
    <Pressable style={as.foodRow} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={as.rowName} numberOfLines={2}>{hit.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text style={as.rowMeta}>
            {hit.serving} - {Math.round(hit.macros.calories)} kcal
          </Text>
          <SourceBadge source={hit.source} />
        </View>
      </View>
      <View style={as.rowRight}>
        <Text style={as.rowKcal}>{Math.round(hit.macros.calories)}</Text>
        <Text style={as.rowKcalUnit}>kcal</Text>
      </View>
    </Pressable>
  )
}

// ---- main ----

const MEAL_OPTIONS: { label: string; value: MealType }[] = [
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Lunch', value: 'lunch' },
  { label: 'Dinner', value: 'dinner' },
  { label: 'Snack', value: 'snack' },
]

type CacheEntry = { q: string; hits: IngredientHit[] }
type Section = { title: string; data: FoodHit[] }

export default function AddFoodScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const today = toLocalISODate()

  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [mealType, setMealType] = useState<MealType>(defaultMealForHour())
  const [searchResults, setSearchResults] = useState<IngredientHit[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedHit, setSelectedHit] = useState<FoodHit | null>(null)
  const [editSheetVisible, setEditSheetVisible] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cacheRef = useRef<CacheEntry[]>([])

  const { data: dayLogs } = useQuery<DayLogs>({
    queryKey: ['day-logs', today],
    queryFn: () => nutritionApi.logs.list(today),
  })

  const { data: favorites = [] } = useQuery<Favorite[]>({
    queryKey: ['favorites'],
    queryFn: () => nutritionApi.favorites.list(),
  })

  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
  })

  const recentLogs: FoodLog[] = useMemo(() => {
    const items = dayLogs?.items ?? []
    return [...items].reverse().slice(0, query.trim() ? 10 : 5)
  }, [dayLogs, query])

  const filteredRecent = useMemo(() => {
    if (!query.trim()) return recentLogs
    const q = query.toLowerCase()
    return recentLogs.filter((l) => l.name.toLowerCase().includes(q))
  }, [recentLogs, query])

  const filteredFavs = useMemo(() => {
    if (!query.trim()) return favorites.slice(0, 5)
    const q = query.toLowerCase()
    return favorites.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 5)
  }, [favorites, query])

  const filteredRecipes = useMemo(() => {
    if (!query.trim()) return recipes.slice(0, 5)
    const q = query.toLowerCase()
    return recipes.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 5)
  }, [recipes, query])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(val.trim()), 300)
  }

  const runSearch = useCallback(async (q: string) => {
    if (!q) { setSearchResults([]); return }

    const cached = cacheRef.current.find((e) => e.q === q)
    if (cached) { setSearchResults(cached.hits); return }

    setSearching(true)
    try {
      const hits = await nutritionApi.searchFoods(q, 15)
      setSearchResults(hits)
      const next = [{ q, hits }, ...cacheRef.current].slice(0, 5)
      cacheRef.current = next
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    void runSearch(debouncedQ)
  }, [debouncedQ, runSearch])

  const openEdit = (hit: FoodHit) => {
    setSelectedHit(hit)
    setEditSheetVisible(true)
    Keyboard.dismiss()
  }

  const handleLogged = () => {
    setEditSheetVisible(false)
    void qc.invalidateQueries({ queryKey: ['day-logs', today] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
    router.back()
  }

  const handleBarcode = async (code: string) => {
    setShowBarcode(false)
    setEstimating(true)
    try {
      const est = await nutritionApi.barcode(code)
      openEdit({
        name: est.name,
        serving: est.serving,
        macros: est.macros,
        micros: (est.micros ?? null) as Record<string, number> | null,
        source: est.source ?? 'usda',
      })
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        Alert.alert('Barcode not found', 'Type the product name to estimate macros.')
      } else {
        Alert.alert('Error', 'Could not look up barcode. Try again.')
      }
    } finally {
      setEstimating(false)
    }
  }

  const handleCameraPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission required', 'Camera access needed.'); return }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
    if (result.canceled || !result.assets[0]) return
    // Defer estimation until the user adds an optional note about the meal.
    setPendingPhotoUri(result.assets[0].uri)
  }

  const runPhotoEstimate = async (uri: string, note: string) => {
    setEstimating(true)
    try {
      const manip = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      )
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')
      const put = await FileSystem.uploadAsync(signed.upload_url, manip.uri, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      })
      if (put.status < 200 || put.status >= 300) throw new Error(`Upload failed (${put.status})`)
      const est = await nutritionApi.estimatePhoto(signed.public_url, note || undefined)
      openEdit({ name: est.name, serving: est.serving, macros: est.macros, micros: (est.micros ?? null) as Record<string, number> | null, source: 'usda' })
    } catch {
      Alert.alert('Error', 'Could not process photo. Try again.')
    } finally {
      setEstimating(false)
    }
  }

  const handleAIEstimate = async () => {
    const q = query.trim()
    if (!q) return
    setEstimating(true)
    try {
      const est = await nutritionApi.estimateText(q)
      openEdit({ name: est.name, serving: est.serving, macros: est.macros, micros: (est.micros ?? null) as Record<string, number> | null, source: 'usda' })
    } catch {
      Alert.alert('Error', 'Could not estimate. Try rephrasing.')
    } finally {
      setEstimating(false)
    }
  }

  const sections: Section[] = []

  // Dedup across history sources by normalized name. A logged recipe shows
  // up both as a recent log and as the recipe itself — prefer the richer
  // saved object (recipe → favorite → recent) so it appears once.
  const historyData: FoodHit[] = (() => {
    const seen = new Set<string>()
    const out: FoodHit[] = []
    const add = (hits: FoodHit[]) => {
      for (const h of hits) {
        const key = h.name.trim().toLowerCase()
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        out.push(h)
      }
    }
    add(filteredRecipes.map(recipeToFoodHit))
    add(filteredFavs.map(favToFoodHit))
    add(filteredRecent.map(logToFoodHit))
    return out
  })()
  if (historyData.length > 0) {
    sections.push({ title: 'From your history', data: historyData })
  }

  if (searchResults.length > 0) {
    sections.push({ title: 'Results', data: searchResults.map(hitToFoodHit) })
  }

  const showEmpty = !query.trim() && historyData.length === 0
  const showNoResults =
    query.trim().length > 0 &&
    !searching &&
    searchResults.length === 0 &&
    filteredRecent.length === 0 &&
    filteredFavs.length === 0 &&
    filteredRecipes.length === 0

  return (
    <View style={as.screen}>
      {/* Header */}
      <View style={as.header}>
        <Text style={as.title}>Add food</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={as.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {/* Search bar */}
      <View style={as.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.gray400} />
        <TextInput
          style={as.searchInput}
          placeholder="Search food..."
          placeholderTextColor={colors.gray400}
          value={query}
          onChangeText={handleQueryChange}
          returnKeyType="search"
          autoFocus
          clearButtonMode="while-editing"
        />
        <Pressable onPress={() => setShowBarcode(true)} hitSlop={8}>
          <Ionicons name="barcode-outline" size={22} color={colors.gray500} />
        </Pressable>
        <Pressable onPress={() => { void handleCameraPhoto() }} hitSlop={8} style={{ marginLeft: 4 }}>
          <Ionicons name="camera-outline" size={22} color={colors.gray500} />
        </Pressable>
      </View>

      {/* Meal chips */}
      <View style={as.mealRow}>
        {MEAL_OPTIONS.map(({ label, value }) => (
          <Pressable
            key={value}
            style={[as.mealChip, mealType === value && as.mealChipActive]}
            onPress={() => setMealType(value)}
          >
            <Text style={[as.mealChipText, mealType === value && as.mealChipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {(searching || estimating) && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      )}

      {showEmpty && !searching && (
        <View style={as.emptyState}>
          <Text style={as.emptyText}>Search for a food or use the camera and barcode icons above.</Text>
        </View>
      )}

      {showNoResults && (
        <View style={as.emptyState}>
          <Text style={as.emptyText}>No matches found.</Text>
          <Pressable style={[as.aiRow, { marginTop: spacing.md }]} onPress={() => { void handleAIEstimate() }}>
            <View style={{ flex: 1 }}>
              <Text style={as.aiTitle}>Use AI to estimate "{query.trim()}"</Text>
              <Text style={as.aiSub}>Best for home-cooked meals or unlisted foods</Text>
            </View>
            <Ionicons name="sparkles-outline" size={20} color="#0d9488" />
          </Pressable>
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item, idx) => `${item.source ?? ''}:${item.name}:${idx}`}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <View style={as.sectionHeader}>
            <Text style={as.sectionTitle}>{section.title.toUpperCase()}</Text>
          </View>
        )}
        renderItem={({ item }) => <FoodRow hit={item} onPress={() => openEdit(item)} />}
        ListFooterComponent={
          query.trim().length > 1 && sections.length > 0 ? (
            <Pressable style={as.aiRow} onPress={() => { void handleAIEstimate() }}>
              <View style={{ flex: 1 }}>
                <Text style={as.aiTitle}>Use AI to estimate "{query.trim()}"</Text>
                <Text style={as.aiSub}>Best for home-cooked meals or unlisted foods</Text>
              </View>
              <Ionicons name="sparkles-outline" size={20} color="#0d9488" />
            </Pressable>
          ) : null
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      />

      <FoodEditSheet
        visible={editSheetVisible}
        hit={selectedHit}
        date={today}
        initialMeal={mealType}
        onClose={() => setEditSheetVisible(false)}
        onLogged={handleLogged}
      />

      <PhotoNoteModal
        visible={pendingPhotoUri !== null}
        imageUri={pendingPhotoUri}
        onCancel={() => setPendingPhotoUri(null)}
        onSubmit={(note) => {
          const uri = pendingPhotoUri
          setPendingPhotoUri(null)
          if (uri) void runPhotoEstimate(uri, note)
        }}
      />

      <BarcodeScanner
        visible={showBarcode}
        onCode={(code) => { void handleBarcode(code) }}
        onCancel={() => setShowBarcode(false)}
      />
    </View>
  )
}

const as = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: Platform.OS === 'ios' ? 56 : spacing.base,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  cancel: { fontSize: 15, color: colors.primary, fontWeight: '600' },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, fontWeight: '500' },

  mealRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    flexWrap: 'nowrap',
  },
  mealChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  mealChipActive: { backgroundColor: colors.gray800, borderColor: colors.gray800 },
  mealChipText: { fontSize: 13, fontWeight: '600', color: colors.gray500 },
  mealChipTextActive: { color: '#fff' },

  sectionHeader: { paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: 6 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.gray400, letterSpacing: 0.6 },

  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.gray500 },
  rowRight: { alignItems: 'flex-end', minWidth: 48 },
  rowKcal: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  rowKcalUnit: { fontSize: 10, color: colors.gray400 },

  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    margin: spacing.base,
    borderRadius: radius.md,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
    gap: spacing.sm,
  },
  aiTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  aiSub: { fontSize: 12, color: colors.gray500, marginTop: 2 },

  emptyState: { flex: 1, padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: 14, color: colors.gray400, textAlign: 'center', lineHeight: 20 },
})
