import React, { useEffect, useState } from 'react'
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
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQueryClient } from '@tanstack/react-query'
import type { FoodLogCreate, Macros, MealType, Micros } from '@fitness/shared-types'
import { nutritionApi } from '../services/api'
import { colors, radius, spacing } from '../theme'
import { toLocalISODate } from '../lib/dates'

// ---- types ----

export interface FoodHit {
  name: string
  serving: string
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  micros?: Record<string, number> | null
  source?: string | null
  usda_fdc_id?: number | null
  data_type?: string
}

interface Props {
  visible: boolean
  hit: FoodHit | null
  date: string
  initialMeal?: MealType
  onClose: () => void
  onLogged: () => void
}

// ---- constants ----

const MEAL_OPTIONS: { label: string; value: MealType }[] = [
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Lunch', value: 'lunch' },
  { label: 'Dinner', value: 'dinner' },
  { label: 'Snack', value: 'snack' },
]

const MEAL_DEFAULT_TIMES: Record<MealType, { h: number; m: number }> = {
  breakfast: { h: 8, m: 0 },
  lunch: { h: 13, m: 0 },
  snack: { h: 16, m: 0 },
  dinner: { h: 19, m: 30 },
}

const MICROS_FIELDS: { key: keyof Micros; label: string; unit: string }[] = [
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { key: 'iron_mg', label: 'Iron', unit: 'mg' },
  { key: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg' },
  { key: 'saturated_fat_g', label: 'Sat. Fat', unit: 'g' },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg' },
]

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  ifct: { bg: '#fef3c7', fg: '#b45309', label: 'IFCT' },
  usda: { bg: '#dbeafe', fg: '#2563eb', label: 'USDA' },
  off: { bg: '#ede9fe', fg: '#7c3aed', label: 'OFF' },
  recent: { bg: '#fff7ed', fg: '#ea580c', label: 'Recent' },
  recipe: { bg: '#ecfdf5', fg: '#16a34a', label: 'Recipe' },
  favorite: { bg: '#fef2f2', fg: '#dc2626', label: 'Fav' },
}

const SERVING_QUICK_OPTIONS = [0.5, 1, 1.5, 2, 3]

// ---- helpers ----

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function defaultMealForHour(): MealType {
  const h = new Date().getHours()
  if (h >= 4 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 15 && h < 18) return 'snack'
  if (h >= 18 && h < 23) return 'dinner'
  return 'snack'
}

function mealDefaultTime(meal: MealType, isoDate: string): Date {
  const { h, m } = MEAL_DEFAULT_TIMES[meal]
  const [y, mo, d] = isoDate.split('-').map(Number)
  const t = new Date(y, mo - 1, d, h, m, 0)
  const now = new Date()
  return t < now ? now : t
}

function buildLoggedAt(isoDate: string, time: Date): string {
  const [y, mo, d] = isoDate.split('-').map(Number)
  return new Date(y, mo - 1, d, time.getHours(), time.getMinutes(), 0).toISOString()
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
}

function macrosFromHit(hit: FoodHit, servings: number) {
  const s = servings
  return {
    calories: String(Math.round(hit.macros.calories * s)),
    protein: String(round1(hit.macros.protein_g * s)),
    carbs: String(round1(hit.macros.carbs_g * s)),
    fat: String(round1(hit.macros.fat_g * s)),
  }
}

function microsFromHit(hit: FoodHit, servings: number): Partial<Record<keyof Micros, string>> {
  if (!hit.micros) return {}
  const out: Partial<Record<keyof Micros, string>> = {}
  for (const { key } of MICROS_FIELDS) {
    const raw = (hit.micros as Record<string, number>)[key as string] ?? 0
    out[key] = String(round1(raw * servings))
  }
  return out
}

// ---- component ----

export default function FoodEditSheet({ visible, hit, date, initialMeal, onClose, onLogged }: Props) {
  const qc = useQueryClient()

  const today = toLocalISODate()
  const yesterday = (() => {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    return toLocalISODate(d)
  })()

  const initMeal = initialMeal ?? defaultMealForHour()

  const [servings, setServings] = useState(1)
  const [calories, setCalories] = useState('0')
  const [protein, setProtein] = useState('0')
  const [carbs, setCarbs] = useState('0')
  const [fat, setFat] = useState('0')
  const [macroOverridden, setMacroOverridden] = useState(false)
  const [microsState, setMicrosState] = useState<Partial<Record<keyof Micros, string>>>({})
  const [selectedDate, setSelectedDate] = useState<'today' | 'yesterday' | 'custom'>('today')
  const [customDate, setCustomDate] = useState(today)
  const [mealType, setMealType] = useState<MealType>(initMeal)
  const [time, setTime] = useState<Date>(() => mealDefaultTime(initMeal, today))
  const [timeOverridden, setTimeOverridden] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [microsOpen, setMicrosOpen] = useState(true)

  // Reset state whenever a new hit is shown
  useEffect(() => {
    if (!hit) return
    const m = initialMeal ?? defaultMealForHour()
    const d = date
    setServings(1)
    const macs = macrosFromHit(hit, 1)
    setCalories(macs.calories)
    setProtein(macs.protein)
    setCarbs(macs.carbs)
    setFat(macs.fat)
    setMacroOverridden(false)
    setMicrosState(microsFromHit(hit, 1))
    setSelectedDate(d === today ? 'today' : d === yesterday ? 'yesterday' : 'custom')
    setCustomDate(d)
    setMealType(m)
    setTime(mealDefaultTime(m, d))
    setTimeOverridden(false)
    setMicrosOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit])

  const resolvedDate =
    selectedDate === 'today' ? today : selectedDate === 'yesterday' ? yesterday : customDate

  const handleMealChip = (meal: MealType) => {
    setMealType(meal)
    if (!timeOverridden) {
      setTime(mealDefaultTime(meal, resolvedDate))
    }
  }

  const applyServings = (next: number) => {
    setServings(next)
    if (!macroOverridden && hit) {
      const macs = macrosFromHit(hit, next)
      setCalories(macs.calories)
      setProtein(macs.protein)
      setCarbs(macs.carbs)
      setFat(macs.fat)
      setMicrosState(microsFromHit(hit, next))
    }
  }

  const handleServingsStep = (delta: number) => {
    const next = Math.max(0.5, round1(servings + delta))
    applyServings(next)
  }

  const handleServingsInput = (val: string) => {
    const n = parseFloat(val)
    if (Number.isFinite(n) && n > 0) applyServings(round1(n))
  }

  const handleResetMacros = () => {
    if (!hit) return
    const macs = macrosFromHit(hit, servings)
    setCalories(macs.calories)
    setProtein(macs.protein)
    setCarbs(macs.carbs)
    setFat(macs.fat)
    setMicrosState(microsFromHit(hit, servings))
    setMacroOverridden(false)
  }

  const handleSave = async () => {
    if (!hit) return
    setSaving(true)
    try {
      const anyMicro = MICROS_FIELDS.some(({ key }) => Number(microsState[key] ?? 0) > 0)
      const micros: Micros | null = anyMicro
        ? (Object.fromEntries(
            MICROS_FIELDS.map(({ key }) => [key, Number(microsState[key] ?? 0)]),
          ) as unknown as Micros)
        : null

      const body: FoodLogCreate = {
        date: resolvedDate,
        name: hit.name,
        serving: hit.serving || '1 serving',
        macros: {
          calories: Number(calories),
          protein_g: Number(protein),
          carbs_g: Number(carbs),
          fat_g: Number(fat),
        } as Macros,
        source: 'manual',
        meal_type: mealType,
        logged_at: buildLoggedAt(resolvedDate, time),
        ...(micros ? { micros } : {}),
        ...(hit.usda_fdc_id != null ? { usda_fdc_id: hit.usda_fdc_id } : {}),
      }

      await nutritionApi.logs.create(body)
      void qc.invalidateQueries({ queryKey: ['day-logs', resolvedDate] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      onLogged()
    } catch {
      Alert.alert('Error', 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!hit) return null

  const badge = SOURCE_BADGE[hit.source?.toLowerCase() ?? '']
  const kcalNum = Math.round(Number(calories))

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={es.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={49}
      >
        <View style={es.card}>
          <View style={es.handle} />

          <ScrollView
            style={es.scroll}
            contentContainerStyle={es.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title + source badge */}
            <View style={es.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={es.foodName} numberOfLines={2}>{hit.name}</Text>
                <Text style={es.servingLabel}>{hit.serving || '1 serving'}</Text>
              </View>
              {badge && (
                <View style={[es.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[es.badgeText, { color: badge.fg }]}>{badge.label}</Text>
                </View>
              )}
            </View>

            {/* Live totals band */}
            <View style={es.totalsBand}>
              <View style={es.kcalBlock}>
                <Text style={es.kcalNum}>{kcalNum}</Text>
                <Text style={es.kcalUnit}>kcal</Text>
              </View>
              <View style={es.macroBlock}>
                <Text style={es.macroNum}>{protein}</Text>
                <Text style={es.macroUnit}>protein g</Text>
              </View>
              <View style={es.macroBlock}>
                <Text style={es.macroNum}>{carbs}</Text>
                <Text style={es.macroUnit}>carbs g</Text>
              </View>
              <View style={es.macroBlock}>
                <Text style={es.macroNum}>{fat}</Text>
                <Text style={es.macroUnit}>fat g</Text>
              </View>
            </View>

            {/* When section */}
            <Text style={es.sectionHead}>When</Text>
            <View style={es.dateChipRow}>
              {(['today', 'yesterday'] as const).map((d) => (
                <Pressable
                  key={d}
                  style={[es.dateChip, selectedDate === d && es.dateChipActive]}
                  onPress={() => setSelectedDate(d)}
                >
                  <Text style={[es.dateChipText, selectedDate === d && es.dateChipTextActive]}>
                    {d === 'today' ? 'Today' : 'Yesterday'}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                style={[es.dateChip, selectedDate === 'custom' && es.dateChipActive]}
                onPress={() => setSelectedDate('custom')}
              >
                <Text style={[es.dateChipText, selectedDate === 'custom' && es.dateChipTextActive]}>
                  {selectedDate === 'custom' ? customDate : 'Custom'}
                </Text>
              </Pressable>
            </View>

            <View style={es.timeRow}>
              <Text style={es.timeLabel}>Time</Text>
              <Pressable style={es.timePill} onPress={() => setPickerOpen(true)}>
                <Text style={es.timePillText}>{fmtTime(time)}</Text>
              </Pressable>
              {pickerOpen && (
                <DateTimePicker
                  value={time}
                  mode="time"
                  display="compact"
                  onChange={(_evt, selected) => {
                    if (Platform.OS !== 'ios') setPickerOpen(false)
                    if (selected) { setTime(selected); setTimeOverridden(true) }
                  }}
                />
              )}
              {Platform.OS === 'ios' && pickerOpen && (
                <Pressable onPress={() => setPickerOpen(false)} style={es.timeDone}>
                  <Text style={es.timeDoneText}>Done</Text>
                </Pressable>
              )}
            </View>

            <View style={es.mealChipRow}>
              {MEAL_OPTIONS.map(({ label, value }) => (
                <Pressable
                  key={value}
                  style={[es.mealChip, mealType === value && es.mealChipActive]}
                  onPress={() => handleMealChip(value)}
                >
                  <Text style={[es.mealChipText, mealType === value && es.mealChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Servings */}
            <Text style={es.sectionHead}>Servings</Text>
            <View style={es.quickRow}>
              {SERVING_QUICK_OPTIONS.map((q) => (
                <Pressable
                  key={q}
                  style={[es.quickChip, servings === q && es.quickChipActive]}
                  onPress={() => applyServings(q)}
                >
                  <Text style={[es.quickChipText, servings === q && es.quickChipTextActive]}>
                    {q}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={es.stepperRow}>
              <Pressable style={es.stepBtn} onPress={() => handleServingsStep(-0.5)}>
                <Text style={es.stepBtnText}>-</Text>
              </Pressable>
              <TextInput
                style={es.stepInput}
                value={String(servings)}
                onChangeText={handleServingsInput}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <Pressable style={es.stepBtn} onPress={() => handleServingsStep(0.5)}>
                <Text style={es.stepBtnText}>+</Text>
              </Pressable>
            </View>

            {/* Macros (editable) */}
            <View style={es.sectionHeadRow}>
              <Text style={es.sectionHead}>Macros</Text>
              {macroOverridden && (
                <Pressable onPress={handleResetMacros}>
                  <Text style={es.resetLink}>Reset</Text>
                </Pressable>
              )}
            </View>
            <View style={es.macroInputRow}>
              {([
                { label: 'Calories', val: calories, set: setCalories },
                { label: 'Protein g', val: protein, set: setProtein },
                { label: 'Carbs g', val: carbs, set: setCarbs },
                { label: 'Fat g', val: fat, set: setFat },
              ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                <View key={label} style={es.macroInputBlock}>
                  <Text style={es.macroInputLabel}>{label}</Text>
                  <TextInput
                    style={es.macroInput}
                    value={val}
                    onChangeText={(v) => { set(v); setMacroOverridden(true) }}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                </View>
              ))}
            </View>

            {/* Micros (collapsible) */}
            <Pressable style={es.sectionHeadRow} onPress={() => setMicrosOpen((v) => !v)}>
              <Text style={es.sectionHead}>Micros</Text>
              <Text style={es.collapseToggle}>{microsOpen ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {microsOpen && (
              <View style={es.microsGrid}>
                {MICROS_FIELDS.map(({ key, label, unit }) => (
                  <View key={key} style={es.microField}>
                    <Text style={es.microLabel}>{label} ({unit})</Text>
                    <TextInput
                      style={es.microInput}
                      value={microsState[key] ?? '0'}
                      onChangeText={(v) => setMicrosState((prev) => ({ ...prev, [key]: v }))}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                ))}
              </View>
            )}

            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Sticky CTA */}
          <View style={es.stickyBottom}>
            <Pressable
              style={[es.addBtn, saving && es.addBtnDisabled]}
              onPress={() => { void handleSave() }}
              disabled={saving}
            >
              <Text style={es.addBtnText}>
                {saving
                  ? 'Saving...'
                  : `Add to ${mealType.charAt(0).toUpperCase() + mealType.slice(1)} - ${kcalNum} kcal`}
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={es.cancelRow}>
            <Text style={es.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---- styles ----

const es = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray300,
    marginTop: 12,
    marginBottom: 4,
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.sm },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  foodName: { fontSize: 17, fontWeight: '700', color: colors.text, flexShrink: 1 },
  servingLabel: { fontSize: 13, color: colors.gray500, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  totalsBand: {
    flexDirection: 'row',
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  kcalBlock: { alignItems: 'center', flex: 1.2 },
  kcalNum: { fontSize: 26, fontWeight: '800', color: colors.primary, fontVariant: ['tabular-nums'] },
  kcalUnit: { fontSize: 11, color: colors.gray500 },
  macroBlock: { alignItems: 'center', flex: 1 },
  macroNum: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  macroUnit: { fontSize: 10, color: colors.gray500 },

  sectionHead: { fontSize: 13, fontWeight: '700', color: colors.gray600, marginBottom: spacing.sm, marginTop: spacing.md },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm },
  resetLink: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  collapseToggle: { fontSize: 12, color: colors.gray500, fontWeight: '600' },

  dateChipRow: { flexDirection: 'row', gap: 6, marginBottom: spacing.sm },
  dateChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateChipText: { fontSize: 13, fontWeight: '600', color: colors.gray600 },
  dateChipTextActive: { color: '#fff' },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  timeLabel: { fontSize: 13, color: colors.gray500, fontWeight: '600' },
  timePill: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.gray50 },
  timePillText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  timeDone: { paddingHorizontal: 10, paddingVertical: 6 },
  timeDoneText: { color: colors.primary, fontWeight: '600' },

  mealChipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  mealChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  mealChipActive: { backgroundColor: colors.gray800, borderColor: colors.gray800 },
  mealChipText: { fontSize: 13, fontWeight: '600', color: colors.gray600 },
  mealChipTextActive: { color: '#fff' },

  quickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: spacing.sm },
  quickChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  quickChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickChipText: { fontSize: 13, fontWeight: '600', color: colors.gray600 },
  quickChipTextActive: { color: '#fff' },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, alignSelf: 'flex-start' },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 20, fontWeight: '700', color: colors.text },
  stepInput: { width: 64, height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text, backgroundColor: colors.surface },

  macroInputRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  macroInputBlock: { width: '47%' },
  macroInputLabel: { fontSize: 11, color: colors.gray500, marginBottom: 4 },
  macroInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 15, fontWeight: '600', color: colors.text, backgroundColor: colors.surface, textAlign: 'center' },

  microsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  microField: { width: '47%' },
  microLabel: { fontSize: 11, color: colors.gray500, marginBottom: 4 },
  microInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, fontSize: 13, color: colors.text, backgroundColor: colors.surface },

  stickyBottom: { paddingHorizontal: spacing.base, paddingTop: spacing.sm },
  addBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelRow: { alignItems: 'center', paddingVertical: spacing.sm },
  cancelText: { fontSize: 14, color: colors.gray500 },
})
