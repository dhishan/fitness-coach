# Food Search + Edit Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "Log food" composer on the Nutrition tab with a full-screen "Add food" search modal + bottom-sheet edit flow backed by the USDA/OFF/IFCT fan-out search API.

**Architecture:** A new expo-router modal route at `app/(tabs)/nutrition/add.tsx` presents a full-screen search screen. Tapping a result opens `FoodEditSheet`, a new bottom-sheet component at `src/components/FoodEditSheet.tsx`. The old composer (Type a meal, Camera, Favorites, Barcode, Recipe buttons) is **replaced** by a single "+ Add food" primary button plus the original Camera / Barcode / Recipe shortcuts kept as secondary icon buttons. This removes clutter while preserving all existing entry paths. The old `PreviewModal` remains unchanged for the camera and barcode paths that still open it directly.

**Tech Stack:** Expo SDK 56, expo-router v4, React Native New Architecture, React Query v5, TypeScript strict, `@fitness/shared-types`, `src/services/api.ts`, `src/theme.ts`

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `mobile/app/(tabs)/nutrition/add.tsx` | Create | Full-screen search modal route |
| `mobile/src/components/FoodEditSheet.tsx` | Create | Bottom-sheet edit + log flow |
| `mobile/app/(tabs)/nutrition.tsx` | Modify | Replace composer with "+ Add food" button; keep camera/barcode/recipe |
| `mobile/app/(tabs)/nutrition/_layout.tsx` | Create | Stack layout wrapper so `add` is a modal inside the nutrition group |

> Note: expo-router requires a `_layout.tsx` inside `(tabs)/nutrition/` so that the tab keeps its index and `add` is a child route presented as a modal.

---

## Task 1: Create the `nutrition` route group with a Stack layout

**Files:**
- Create: `mobile/app/(tabs)/nutrition/_layout.tsx`
- Create: `mobile/app/(tabs)/nutrition/index.tsx` (thin re-export of existing nutrition.tsx content)

### Why
`nutrition.tsx` currently lives at `(tabs)/nutrition.tsx` (a flat file = a tab). To add a child route `add`, we need to convert the tab into a route group: move the screen into `nutrition/index.tsx` and add a `_layout.tsx` that wraps with a Stack.

- [ ] **Step 1: Create `mobile/app/(tabs)/nutrition/_layout.tsx`**

```tsx
import { Stack } from 'expo-router'

export default function NutritionLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: false }} />
    </Stack>
  )
}
```

- [ ] **Step 2: Move the existing file**

```bash
mv /Users/dhishan/Projects/fitness-tracker/mobile/app/(tabs)/nutrition.tsx \
   /Users/dhishan/Projects/fitness-tracker/mobile/app/(tabs)/nutrition/index.tsx
```

- [ ] **Step 3: Verify the tab still resolves**

```bash
cd /Users/dhishan/Projects/fitness-tracker/mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero new errors (some pre-existing ones are acceptable if present before this change).

- [ ] **Step 4: Commit**

```bash
cd /Users/dhishan/Projects/fitness-tracker && git checkout -b feat/food-search-sheet
git add mobile/app/\(tabs\)/nutrition/
git commit -m "$(cat <<'EOF'
refactor(mobile/nutrition): convert flat tab file to route group for child modal

Moves nutrition.tsx → nutrition/index.tsx and adds _layout.tsx so the
nutrition tab can host the upcoming add.tsx modal child route.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `FoodEditSheet` component

**Files:**
- Create: `mobile/src/components/FoodEditSheet.tsx`

This is the bottom-sheet presented when the user taps a food row in the search screen. It receives a `FoodHit` (name, serving, macros, micros, source, usda_fdc_id) plus the target date, and handles servings/time/meal selection and final log creation.

### Types used (from shared-types and api.ts)
- `Macros`, `Micros`, `MealType`, `FoodLogCreate` from `@fitness/shared-types`
- `IngredientHit` from `../services/api`

### Internal state
```ts
// Servings
servings: number            // default 1
baseServings: number        // always 1 (for reset)

// Macros (editable, recalculated when servings changes)
calories: string
protein: string
carbs: string
fat: string
macroOverridden: boolean    // true if user manually edited a macro field

// Micros (editable)
microsState: Partial<Record<keyof Micros, string>>

// When
selectedDate: 'today' | 'yesterday' | 'custom'
customDate: string          // ISO YYYY-MM-DD
mealType: MealType
time: Date                  // displayed as HH:MM AM/PM
timeOverridden: boolean     // true once user touches the time picker

// UI
saving: boolean
pickerOpen: boolean
```

### Meal default times
```ts
const MEAL_DEFAULT_TIMES: Record<MealType, { h: number; m: number }> = {
  breakfast: { h: 8, m: 0 },
  lunch: { h: 13, m: 0 },
  snack: { h: 16, m: 0 },
  dinner: { h: 19, m: 30 },
}
```

When a meal chip is tapped AND `timeOverridden` is false: compute the default time for the new meal. If that time is in the past on the selected date, fall back to `new Date()` instead.

### Servings recalculation
Whenever `servings` changes (and `macroOverridden` is false):
```ts
const scale = servings / baseServings
setCalories(String(Math.round(hit.macros.calories * scale)))
setProtein(String(round1(hit.macros.protein_g * scale)))
setCarbs(String(round1(hit.macros.carbs_g * scale)))
setFat(String(round1(hit.macros.fat_g * scale)))
// micros also scale
```

### Source badge colors
```ts
const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  ifct: { bg: '#fef3c7', fg: '#b45309', label: 'IFCT' },
  usda: { bg: '#dbeafe', fg: '#2563eb', label: 'USDA' },
  off: { bg: '#ede9fe', fg: '#7c3aed', label: 'OFF' },
  recent: { bg: '#fff7ed', fg: '#ea580c', label: 'Recent' },
  recipe: { bg: '#ecfdf5', fg: '#16a34a', label: 'Recipe' },
  favorite: { bg: '#fef2f2', fg: '#dc2626', label: 'Favorite' },
}
```

### `consumed_at` ISO timestamp construction
`FoodLogCreate` uses `logged_at?: string | null` (ISO 8601). Build it from selected date + selected time:
```ts
function buildLoggedAt(isoDate: string, time: Date): string {
  const [y, mo, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, mo - 1, d, time.getHours(), time.getMinutes(), 0)
  return dt.toISOString()
}
```

### Props interface
```ts
export interface FoodHit {
  name: string
  serving: string
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  micros?: Record<string, number> | null
  source?: string | null        // 'usda' | 'off' | 'ifct' | 'recent' | 'recipe' | 'favorite'
  usda_fdc_id?: number | null
  data_type?: string
}

interface FoodEditSheetProps {
  visible: boolean
  hit: FoodHit | null
  date: string                  // ISO date of the nutrition day being viewed
  initialMeal?: MealType        // pre-selected from the search screen meal chip
  onClose: () => void
  onLogged: () => void          // called after successful save, triggers query invalidation upstream
}
```

### Full component skeleton

- [ ] **Step 1: Write `mobile/src/components/FoodEditSheet.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react'
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
    const raw = hit.micros[key as string] ?? 0
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

  const handleServingsStep = (delta: number) => {
    const next = Math.max(0.5, round1(servings + delta))
    applyServings(next)
  }

  const handleServingsInput = (val: string) => {
    const n = parseFloat(val)
    if (Number.isFinite(n) && n > 0) applyServings(round1(n))
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
        ? (Object.fromEntries(MICROS_FIELDS.map(({ key }) => [key, Number(microsState[key] ?? 0)])) as unknown as Micros)
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
          {/* drag handle */}
          <View style={es.handle} />

          <ScrollView
            style={es.scroll}
            contentContainerStyle={es.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 1. Title + badge */}
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

            {/* 2. Totals band */}
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

            {/* 3. When */}
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

            {/* 4. Servings */}
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

            {/* 5. Macros (editable) */}
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

            {/* 6. Micros (collapsible) */}
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

            {/* spacer for sticky button */}
            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Sticky bottom CTA */}
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

          {/* Cancel link below CTA */}
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
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/dhishan/Projects/fitness-tracker/mobile && npx tsc --noEmit 2>&1 | grep -i "FoodEditSheet\|error" | head -20
```

Expected: no errors in FoodEditSheet.tsx.

- [ ] **Step 3: Commit**

```bash
cd /Users/dhishan/Projects/fitness-tracker
git add mobile/src/components/FoodEditSheet.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add FoodEditSheet bottom-sheet component

Handles servings, meal/time selection, macro/micro editing, and
nutritionApi.logs.create. Opens from the food search screen on row tap.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `nutrition/add.tsx` - the full-screen search modal

**Files:**
- Create: `mobile/app/(tabs)/nutrition/add.tsx`

This is the full-screen modal route. It renders:
1. Header with "Add food" title + "Cancel" link
2. Sticky search input + barcode icon + camera icon
3. Meal chip row (auto-selected on mount based on current hour)
4. SectionList body: "From your history" section + "Results" section + AI fallback row
5. Tapping a row opens `FoodEditSheet`

### Search behavior
- 300ms debounce on text input
- On query change: call `nutritionApi.searchFoods(q, 15)` AND filter `recentLogs` (fetched once on mount via `nutritionApi.logs.list(today)`) in parallel
- Client-side LRU cache of last 5 queries using a `useRef` Map
- Before typing: show recent logs (last 5) + favorites + recipes from existing query cache

### IngredientHit -> FoodHit mapping
`IngredientHit` from api.ts already matches `FoodHit` interface shape. Map `source` from the hit's `data_type` or the presence of `usda_fdc_id`:
```ts
function hitToFoodHit(h: IngredientHit, source?: string): FoodHit {
  return {
    name: h.name,
    serving: h.serving,
    macros: h.macros,
    micros: h.micros ?? null,
    usda_fdc_id: h.usda_fdc_id ?? null,
    data_type: h.data_type,
    source: source ?? (h.usda_fdc_id ? 'usda' : 'off'),
  }
}
```

The backend `/foods/search` endpoint returns hits that currently don't have a `source` field on `IngredientHit`. Infer source from `data_type` field: if `data_type` includes 'SR Legacy' or 'Foundation' -> `'usda'`; if `usda_fdc_id` is null -> `'off'`. This heuristic matches the three-source fan-out (USDA / OFF / IFCT). Update once backend adds explicit `source`.

### Recent logs -> FoodHit
```ts
function logToFoodHit(log: FoodLog): FoodHit {
  return {
    name: log.name,
    serving: log.serving,
    macros: log.macros,
    micros: log.micros ?? null,
    usda_fdc_id: log.usda_fdc_id ?? null,
    source: 'recent',
  }
}
```

### Favorites -> FoodHit
```ts
function favToFoodHit(fav: Favorite): FoodHit {
  return {
    name: fav.name,
    serving: fav.serving,
    macros: fav.macros,
    micros: null,
    source: 'favorite',
  }
}
```

### Full component

- [ ] **Step 1: Write `mobile/app/(tabs)/nutrition/add.tsx`**

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import type { DayLogs, Favorite, FoodLog, MealType } from '@fitness/shared-types'
import { nutritionApi, uploadsApi, type IngredientHit } from '../../../src/services/api'
import type { FoodHit } from '../../../src/components/FoodEditSheet'
import FoodEditSheet from '../../../src/components/FoodEditSheet'
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
  let source = 'usda'
  if (h.usda_fdc_id == null) source = 'off'
  else if (h.data_type?.toLowerCase().includes('ifct')) source = 'ifct'
  return {
    name: h.name,
    serving: h.serving,
    macros: h.macros,
    micros: h.micros ?? null,
    usda_fdc_id: h.usda_fdc_id ?? null,
    data_type: h.data_type,
    source,
  }
}

function logToFoodHit(log: FoodLog): FoodHit {
  return {
    name: log.name,
    serving: log.serving,
    macros: log.macros,
    micros: log.micros ?? null,
    usda_fdc_id: log.usda_fdc_id ?? null,
    source: 'recent',
  }
}

function favToFoodHit(fav: Favorite): FoodHit {
  return { name: fav.name, serving: fav.serving, macros: fav.macros, micros: null, source: 'favorite' }
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

  // debounce
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
        micros: est.micros ?? null,
        source: est.source ?? 'usda',
      })
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        Alert.alert('Barcode not found', "Type the product name to estimate macros.")
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
    setEstimating(true)
    try {
      const asset = result.assets[0]
      const manip = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1024 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG })
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')
      const put = await FileSystem.uploadAsync(signed.upload_url, manip.uri, { httpMethod: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT })
      if (put.status < 200 || put.status >= 300) throw new Error(`Upload failed (${put.status})`)
      const est = await nutritionApi.estimatePhoto(signed.public_url)
      openEdit({ name: est.name, serving: est.serving, macros: est.macros, micros: est.micros ?? null, source: 'usda' })
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
      openEdit({ name: est.name, serving: est.serving, macros: est.macros, micros: est.micros ?? null, source: 'usda' })
    } catch {
      Alert.alert('Error', 'Could not estimate. Try rephrasing.')
    } finally {
      setEstimating(false)
    }
  }

  // Build sections for SectionList
  type Section = { title: string; data: FoodHit[] }

  const sections: Section[] = []

  const historyData: FoodHit[] = [
    ...filteredRecent.map(logToFoodHit),
    ...filteredFavs.map(favToFoodHit),
  ]
  if (historyData.length > 0) {
    sections.push({ title: 'From your history', data: historyData })
  }

  if (searchResults.length > 0) {
    sections.push({ title: 'Results', data: searchResults.map(hitToFoodHit) })
  }

  const showEmpty = !query.trim() && historyData.length === 0
  const showNoResults = query.trim().length > 0 && !searching && searchResults.length === 0 && filteredRecent.length === 0 && filteredFavs.length === 0

  return (
    <View style={as.screen}>
      {/* Header */}
      <View style={as.header}>
        <Text style={as.title}>Add food</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={as.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {/* Search input */}
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

      {/* Activity indicator */}
      {(searching || estimating) && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      )}

      {showEmpty && !searching && (
        <View style={as.emptyState}>
          <Text style={as.emptyText}>Search for a food or use the camera / barcode icons above.</Text>
        </View>
      )}

      {showNoResults && (
        <View style={as.emptyState}>
          <Text style={as.emptyText}>No matches found.</Text>
        </View>
      )}

      {/* Results list */}
      <SectionList
        sections={sections}
        keyExtractor={(item, idx) => `${item.source}:${item.name}:${idx}`}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <View style={as.sectionHeader}>
            <Text style={as.sectionTitle}>{section.title.toUpperCase()}</Text>
          </View>
        )}
        renderItem={({ item }) => <FoodRow hit={item} onPress={() => openEdit(item)} />}
        ListFooterComponent={
          query.trim().length > 1 ? (
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, paddingTop: Platform.OS === 'ios' ? 56 : spacing.base, paddingBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  cancel: { fontSize: 15, color: colors.primary, fontWeight: '600' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, marginHorizontal: spacing.base, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, fontWeight: '500' },

  mealRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.base, paddingBottom: spacing.sm, flexWrap: 'nowrap' },
  mealChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  mealChipActive: { backgroundColor: colors.gray800, borderColor: colors.gray800 },
  mealChipText: { fontSize: 13, fontWeight: '600', color: colors.gray500 },
  mealChipTextActive: { color: '#fff' },

  sectionHeader: { paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: 6 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.gray400, letterSpacing: 0.6 },

  foodRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.gray100, backgroundColor: colors.surface, gap: spacing.sm },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.gray500 },
  rowRight: { alignItems: 'flex-end', minWidth: 48 },
  rowKcal: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  rowKcalUnit: { fontSize: 10, color: colors.gray400 },

  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  aiRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.base, margin: spacing.base, borderRadius: radius.md, backgroundColor: '#f0fdfa', borderWidth: 1, borderColor: '#ccfbf1', gap: spacing.sm },
  aiTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  aiSub: { fontSize: 12, color: colors.gray500, marginTop: 2 },

  emptyState: { flex: 1, padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: 14, color: colors.gray400, textAlign: 'center', lineHeight: 20 },
})
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/dhishan/Projects/fitness-tracker/mobile && npx tsc --noEmit 2>&1 | grep "add.tsx\|FoodEditSheet\|error TS" | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /Users/dhishan/Projects/fitness-tracker
git add mobile/app/\(tabs\)/nutrition/add.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add full-screen food search modal (nutrition/add)

Debounced USDA/OFF/IFCT search, recent/favorites history sections,
barcode + camera shortcuts, and AI estimate fallback row.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `nutrition/index.tsx` - replace composer with "+ Add food" button

**Files:**
- Modify: `mobile/app/(tabs)/nutrition/index.tsx`

### Decision: augment vs replace
The old composer (Type a meal, Camera, Favorites, Barcode, Recipe) is **replaced** by:
1. A single large "+ Add food" primary button (opens `nutrition/add`)
2. A secondary row of icon buttons: Camera (photo AI), Barcode, Recipe

This preserves all entry paths while removing the cluttered 6-button grid. The old `PreviewModal` still handles camera and barcode results directly from the nutrition index screen, as those are quick one-tap actions that don't need the full search flow.

### Changes
- Import `useRouter` (already imported) - route to `/nutrition/add` on press
- Remove `composerMode === 'text'` branch and the multiline TextInput + Estimate flow (the new search modal replaces it)
- Remove Favorites button from composer (accessible via the search modal's history section)
- Remove "Type a meal" / "Manage recipes" from the composer row
- Keep Camera, Barcode, Recipe buttons as secondary icons
- Keep `PreviewModal`, `FavoritesModal`, `RecipePickerModal` unchanged

### New composer JSX (replace the entire `{composerMode === 'idle' && ...}` and `{composerMode === 'text' && ...}` blocks):

```tsx
{/* Primary add button */}
<Pressable
  style={[s.addFoodBtn]}
  onPress={() => router.push('/nutrition/add' as never)}
>
  <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
  <Text style={s.addFoodBtnText}>+ Add food</Text>
</Pressable>

{/* Secondary quick-access row */}
<View style={[s.row, { marginTop: spacing.sm, gap: spacing.sm }]}>
  <Pressable style={[s.composerBtn, s.composerBtnIcon]} onPress={handleCamera}>
    <Ionicons name="camera-outline" size={22} color={colors.gray700} />
    <Text style={s.composerBtnText}>Camera</Text>
  </Pressable>
  <Pressable style={[s.composerBtn, s.composerBtnIcon]} onPress={() => setShowBarcode(true)}>
    <Ionicons name="barcode-outline" size={22} color={colors.gray700} />
    <Text style={s.composerBtnText}>Barcode</Text>
  </Pressable>
  <Pressable style={[s.composerBtn, s.composerBtnIcon]} onPress={() => setShowRecipes(true)}>
    <Ionicons name="restaurant-outline" size={22} color={colors.gray700} />
    <Text style={s.composerBtnText}>Recipe</Text>
  </Pressable>
</View>
```

Also add these two styles to `StyleSheet.create(s)`:
```ts
addFoodBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.primary,
  borderRadius: radius.md,
  paddingVertical: 14,
  marginTop: spacing.sm,
},
addFoodBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
```

Also remove from state: `composerMode`, `textInput`, `suggestQ`, `debounceRef`, `foodSuggestions` query, `closeTextComposer`, `handleSelectSuggestion`, `handleEstimateText` (the text estimate is now in the search modal).

Keep everything else: date nav, goals, day logs, Camera flow, Barcode flow, PreviewModal, FavoritesModal, RecipePickerModal, GoalsSetModal, GoalsSuggestModal.

- [ ] **Step 1: Apply changes to `mobile/app/(tabs)/nutrition/index.tsx`**

Remove the `ComposerMode` type and all `composerMode` state/logic. Remove the `FoodSuggestion` query. Remove `textInput`, `suggestQ`, `debounceRef`, `handleEstimateText`, `closeTextComposer`, `handleSelectSuggestion`. Replace composer JSX with the new buttons. Add the two new styles.

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/dhishan/Projects/fitness-tracker/mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: clean (or same pre-existing errors as before).

- [ ] **Step 3: Manual smoke test checklist**
  - "+ Add food" button navigates to search modal
  - "Cancel" in search modal goes back to nutrition tab
  - Tapping a search result opens FoodEditSheet
  - "Add to Breakfast - X kcal" logs and returns to nutrition tab
  - Camera button on index screen still opens photo picker
  - Barcode button on index screen still scans
  - Recipe button still opens RecipePickerModal

- [ ] **Step 4: Final typecheck**

```bash
cd /Users/dhishan/Projects/fitness-tracker/mobile && npx tsc --noEmit 2>&1
```

Expected: zero new TS errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/dhishan/Projects/fitness-tracker
git add mobile/app/\(tabs\)/nutrition/index.tsx
git commit -m "$(cat <<'EOF'
feat(mobile/nutrition): replace inline text composer with unified Add food modal

Composer is now a single primary button that opens nutrition/add for
search-based logging. Camera, barcode, and recipe shortcuts remain as
secondary icon buttons. PreviewModal and RecipePickerModal unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

### Spec coverage check

| Spec requirement | Covered in task |
|---|---|
| Full-screen search modal route | Task 3 (add.tsx) |
| Header with "Add food" + Cancel | Task 3 |
| Sticky search + barcode + camera icons | Task 3 |
| Meal chip row auto-selected by hour | Task 3 |
| From your history section | Task 3 |
| Results section with source badges | Task 3 |
| AI fallback row | Task 3 |
| 300ms debounce | Task 3 |
| Client-side query cache (last 5) | Task 3 |
| keyboardShouldPersistTaps | Task 3 (on SectionList) |
| Edit sheet title + source badge + serving label | Task 2 |
| Totals band live macro grid | Task 2 |
| When section (day, time, meal chip) | Task 2 |
| Meal chip -> auto-fill time (unless overridden) | Task 2 |
| Servings quick chips | Task 2 |
| Custom stepper | Task 2 |
| Macros editable with Reset | Task 2 |
| Micros collapsible | Task 2 |
| Sticky "Add to Meal - kcal" button | Task 2 |
| FoodLogCreate payload with logged_at | Task 2 |
| Invalidate day-logs + dashboard on save | Task 2 + Task 3 |
| Hook up "+ Add food" on nutrition tab | Task 4 |
| Preserve existing camera/barcode/recipe | Task 4 |
| Route group layout | Task 1 |
| TypeScript clean | Task 4 step 4 |
| Feature branch | Task 1 step 4 |

### Gaps / TODOs

1. **Serving size picker**: spec mentions "if backend returned multiple serving sizes". `IngredientHit` currently has a single `serving` string. The sheet shows that one statically - no picker needed until the API adds `serving_options: string[]`.

2. **Empty state before typing**: spec says "show Recent + Favorites + Your recipes". This plan shows Recent (from today's logs) + Favorites. Recipes are omitted from the history section since `Recipe` objects don't directly convert to `FoodHit` (they have per-serving macros but logging requires servings input - that's a separate flow). The existing Recipe button on the index screen covers this.

3. **IFCT source detection**: the heuristic (`data_type` includes 'ifct') may not fire unless the backend sets `data_type` accordingly. Outcome: IFCT rows get the blue USDA badge instead of yellow IFCT badge. Low impact, fixable once API is confirmed.

4. **`FoodLogSource` type**: `FoodLogCreate.source` expects `'ai_text' | 'ai_photo' | 'favorite' | 'manual'`. Rows tapped from search are logged as `'manual'`. If the backend later adds `'usda'` | `'off'` as valid sources, update accordingly.

5. **Snackbar/toast "Added"**: spec asks for a toast after logging. The plan returns to the nutrition tab which refreshes (via React Query invalidation). Adding a toast requires an app-wide toast system not currently in the codebase; skipped for now.
