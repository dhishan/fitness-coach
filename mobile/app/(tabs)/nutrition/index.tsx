import React, { useEffect, useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DayLogs,
  Estimation,
  Favorite,
  FoodLog,
  Goals,
  GoalSuggestion,
  Macros,
  MealType,
  Micros,
} from '@fitness/shared-types'
import { nutritionApi, uploadsApi } from '../../../src/services/api'
import { track } from '../../../src/lib/observability'
import { colors, spacing, radius, card } from '../../../src/theme'
import { toLocalISODate } from '../../../src/lib/dates'
import BarcodeScanner from '../../../components/BarcodeScanner'
import FoodEditSheet from '../../../src/components/FoodEditSheet'

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function prevDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return toLocalISODate(d)
}

function nextDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return toLocalISODate(d)
}

function formatDate(iso: string): string {
  const today = toLocalISODate()
  if (iso === today) return 'Today'
  const yesterday = prevDate(today)
  if (iso === yesterday) return 'Yesterday'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Meal type helpers
// ---------------------------------------------------------------------------

function defaultMealType(): MealType {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 17 && h < 21) return 'dinner'
  return 'snack'
}

const MEAL_TYPE_OPTIONS: { label: string; value: MealType }[] = [
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Lunch', value: 'lunch' },
  { label: 'Dinner', value: 'dinner' },
  { label: 'Snack', value: 'snack' },
]

// ---------------------------------------------------------------------------
// Meal grouping
// ---------------------------------------------------------------------------

function mealGroup(log: FoodLog): 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' {
  if (log.meal_type) {
    const map: Record<MealType, 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks'> = {
      breakfast: 'Breakfast',
      lunch: 'Lunch',
      dinner: 'Dinner',
      snack: 'Snacks',
    }
    return map[log.meal_type]
  }
  const ts = log.logged_at ?? log.created_at
  if (!ts) return 'Snacks'
  const h = new Date(ts).getHours()
  if (h >= 5 && h < 11) return 'Breakfast'
  if (h >= 11 && h < 15) return 'Lunch'
  if (h >= 17 && h < 22) return 'Dinner'
  return 'Snacks'
}

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const

// ---------------------------------------------------------------------------
// Micros helpers
// ---------------------------------------------------------------------------

interface MicroField { key: keyof Micros; label: string; unit: string }

const MICROS_FIELDS: MicroField[] = [
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

function hasMicros(m: Micros | null | undefined): boolean {
  if (!m) return false
  return MICROS_FIELDS.some(({ key }) => (m[key] ?? 0) > 0)
}

// ---------------------------------------------------------------------------
// MacroBar
// ---------------------------------------------------------------------------

function MacroBar({ value, goal, label }: { value: number; goal: number; label: string }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  return (
    <View style={{ flex: 1 }}>
      <View style={s.macroBarHeader}>
        <Text style={s.macroLabel}>{label}</Text>
        <Text style={s.macroValue}>
          {Math.round(value)}{goal > 0 ? `/${Math.round(goal)}g` : 'g'}
        </Text>
      </View>
      <View style={s.macroBarBg}>
        <View style={[s.macroBarFill, { width: `${pct}%` as unknown as number }]} />
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// MicrosPanel (collapsible)
// ---------------------------------------------------------------------------

function MicrosPanel({ micros, source, targets }: {
  micros: Micros | null | undefined
  source?: 'ai' | 'usda' | null
  targets?: Micros | null
}) {
  const [open, setOpen] = useState(false)
  if (!hasMicros(micros)) return null

  return (
    <View style={s.microsPanel}>
      <Pressable onPress={() => setOpen((v) => !v)} style={s.microsPanelHeader}>
        <Text style={s.microsPanelTitle}>{open ? 'v ' : '> '}Micros</Text>
        {source === 'usda' && (
          <View style={s.usdaBadge}>
            <Text style={s.usdaBadgeText}>USDA</Text>
          </View>
        )}
      </Pressable>
      {open && micros && (
        <View style={s.microsList}>
          {MICROS_FIELDS.map(({ key, label, unit }) => {
            const val = micros[key] ?? 0
            const goal = targets?.[key] ?? 0
            const pct = goal > 0 ? Math.min(100, (val / goal) * 100) : 0
            return (
              <View key={key} style={s.microRow}>
                <View style={s.microRowHeader}>
                  <Text style={s.microRowLabel}>{label}</Text>
                  <Text style={s.microRowVal}>{Math.round(val)}{unit}{goal > 0 ? `/${Math.round(goal)}${unit}` : ''}</Text>
                </View>
                <View style={s.microBarBg}>
                  <View style={[s.microBarFill, { width: `${pct}%` as unknown as number }]} />
                </View>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// MicrosTargetsSection (collapsible, for goals modal)
// ---------------------------------------------------------------------------

function MicrosTargetsSection({ values, onChange }: {
  values: Partial<Record<keyof Micros, string>>
  onChange: (k: keyof Micros, v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <View style={s.microsTargetsSection}>
      <Pressable onPress={() => setOpen((v) => !v)} style={s.microsPanelHeader}>
        <Text style={s.microsPanelTitle}>{open ? 'v ' : '> '}Micros targets (optional)</Text>
      </Pressable>
      {open && (
        <View style={s.microsTargetsGrid}>
          {MICROS_FIELDS.map(({ key, label, unit }) => (
            <View key={key} style={s.microsTargetField}>
              <Text style={s.microsTargetLabel}>{label} ({unit})</Text>
              <TextInput
                style={s.microsTargetInput}
                value={values[key] ?? ''}
                onChangeText={(v) => onChange(key, v)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.gray400}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// PreviewModal
// ---------------------------------------------------------------------------

interface PreviewState {
  estimation: Estimation
  source: 'ai_text' | 'ai_photo'
  editId?: string
}

function PreviewModal({
  state,
  date,
  onSaved,
  onCancel,
}: {
  state: PreviewState
  date: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(state.estimation.name)
  const [serving, setServing] = useState(state.estimation.serving)
  const [calories, setCalories] = useState(String(Math.round(state.estimation.macros.calories)))
  const [protein, setProtein] = useState(String(Math.round(state.estimation.macros.protein_g)))
  const [carbs, setCarbs] = useState(String(Math.round(state.estimation.macros.carbs_g)))
  const [fat, setFat] = useState(String(Math.round(state.estimation.macros.fat_g)))
  const [saving, setSaving] = useState(false)
  const [mealType, setMealType] = useState<MealType>(defaultMealType())

  // Time picker (defaults to now; only sent if user changes it)
  const [initialTime] = useState(() => new Date())
  const [time, setTime] = useState<Date>(initialTime)
  const [pickerOpen, setPickerOpen] = useState(false)
  const timeChanged =
    time.getHours() !== initialTime.getHours() ||
    time.getMinutes() !== initialTime.getMinutes()
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })

  const qc = useQueryClient()

  const confidence = Math.round(state.estimation.confidence * 100)

  const handleSave = async () => {
    setSaving(true)
    const macros: Macros = {
      calories: Number(calories),
      protein_g: Number(protein),
      carbs_g: Number(carbs),
      fat_g: Number(fat),
    }
    // Only send logged_at if user changed time
    const logged_at: string | undefined = timeChanged ? time.toISOString() : undefined
    try {
      if (state.editId) {
        await nutritionApi.logs.update(state.editId, { name, serving, macros })
      } else {
        await nutritionApi.logs.create({
          date,
          name,
          serving,
          macros,
          source: state.source,
          meal_type: mealType,
          ...(logged_at ? { logged_at } : {}),
          ...(state.estimation.micros ? { micros: state.estimation.micros } : {}),
          ...(state.estimation.usda_fdc_id != null ? { usda_fdc_id: state.estimation.usda_fdc_id } : {}),
          ...(state.estimation.micros_source ? { micros_source: state.estimation.micros_source } : {}),
        })
        track('nutrition.log.created', { source: state.source, calories: macros.calories })
      }
      void qc.invalidateQueries({ queryKey: ['day-logs', date] })
      onSaved()
    } catch {
      Alert.alert('Error', 'Could not save log')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={Keyboard.dismiss}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={s.sheetScroll} contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled">
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{state.editId ? 'Edit log' : 'Confirm entry'}</Text>
            <View style={s.confidenceChip}>
              <Text style={s.confidenceText}>{confidence}% confident</Text>
            </View>
          </View>

          {/* Meal type chips + time (only when creating) */}
          {!state.editId && (
            <>
              <View style={s.mealChipRow}>
                {MEAL_TYPE_OPTIONS.map(({ label, value }) => (
                  <Pressable
                    key={value}
                    onPress={() => setMealType(value)}
                    style={[s.mealChip, mealType === value && s.mealChipActive]}
                  >
                    <Text style={[s.mealChipText, mealType === value && s.mealChipTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.timeRow}>
                <Text style={s.timeLabel}>Time:</Text>
                <Pressable style={s.timePill} onPress={() => setPickerOpen(true)}>
                  <Text style={s.timePillText}>{fmtTime(time)}</Text>
                </Pressable>
                {pickerOpen && (
                  <DateTimePicker
                    value={time}
                    mode="time"
                    display="compact"
                    onChange={(_evt, selected) => {
                      if (Platform.OS !== 'ios') setPickerOpen(false)
                      if (selected) setTime(selected)
                    }}
                  />
                )}
                {Platform.OS === 'ios' && pickerOpen && (
                  <Pressable onPress={() => setPickerOpen(false)} style={s.timeDone}>
                    <Text style={s.timeDoneText}>Done</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}

          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Food name"
            placeholderTextColor={colors.gray400}
          />
          <TextInput
            style={s.input}
            value={serving}
            onChangeText={setServing}
            placeholder="Serving size"
            placeholderTextColor={colors.gray400}
          />

          <View style={s.macroRow}>
            {([
              { label: 'kcal', val: calories, set: setCalories },
              { label: 'protein', val: protein, set: setProtein },
              { label: 'carbs', val: carbs, set: setCarbs },
              { label: 'fat', val: fat, set: setFat },
            ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
              <View key={label} style={s.macroInput}>
                <TextInput
                  style={s.macroNumInput}
                  value={val}
                  onChangeText={set}
                  keyboardType="numeric"
                  placeholderTextColor={colors.gray400}
                />
                <Text style={s.macroLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {/* Micros panel */}
          <MicrosPanel
            micros={state.estimation.micros}
            source={state.estimation.micros_source}
          />

          <View style={s.btnRow}>
            <Pressable
              style={[s.btnPrimary, saving && s.btnDisabled]}
              onPress={() => { void handleSave() }}
              disabled={saving}
            >
              <Text style={s.btnPrimaryText}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
            <Pressable style={s.btnSecondary} onPress={onCancel}>
              <Text style={s.btnSecondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// GoalsSuggestModal
// ---------------------------------------------------------------------------

function GoalsSuggestModal({
  onClose,
  onAccept,
}: {
  onClose: () => void
  onAccept: (g: Goals) => void
}) {
  const [bodyweight, setBodyweight] = useState('')
  const [goalText, setGoalText] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestion, setSuggestion] = useState<GoalSuggestion | null>(null)

  const handleSuggest = async () => {
    setLoading(true)
    try {
      const params: { bodyweight_kg?: number; goal_text?: string } = {}
      if (bodyweight) params.bodyweight_kg = Number(bodyweight)
      if (goalText) params.goal_text = goalText
      const s = await nutritionApi.goals.suggest(params)
      setSuggestion(s)
    } catch {
      Alert.alert('Error', 'Could not get suggestion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={Keyboard.dismiss}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Suggest daily goals</Text>

          {!suggestion ? (
            <>
              <Text style={s.fieldLabel}>Bodyweight (kg) - optional</Text>
              <TextInput
                style={s.input}
                value={bodyweight}
                onChangeText={setBodyweight}
                keyboardType="numeric"
                placeholder="e.g. 80"
                placeholderTextColor={colors.gray400}
              />
              <Text style={s.fieldLabel}>Your goal - optional</Text>
              <TextInput
                style={[s.input, { height: 64 }]}
                value={goalText}
                onChangeText={setGoalText}
                placeholder="e.g. lose fat while maintaining muscle"
                placeholderTextColor={colors.gray400}
                multiline
              />
              <View style={s.btnRow}>
                <Pressable
                  style={[s.btnPrimary, loading && s.btnDisabled]}
                  onPress={() => { void handleSuggest() }}
                  disabled={loading}
                >
                  <Text style={s.btnPrimaryText}>
                    {loading ? 'Getting suggestion...' : 'Get suggestion'}
                  </Text>
                </Pressable>
                <Pressable style={s.btnSecondary} onPress={onClose}>
                  <Text style={s.btnSecondaryText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={s.suggestionBox}>
                <Text style={s.suggestionRationale}>{suggestion.rationale}</Text>
                <View style={s.macroRow}>
                  {([
                    ['kcal', suggestion.proposal.calories],
                    ['protein', suggestion.proposal.protein_g],
                    ['carbs', suggestion.proposal.carbs_g],
                    ['fat', suggestion.proposal.fat_g],
                  ] as [string, number][]).map(([label, val]) => (
                    <View key={label} style={s.macroStatItem}>
                      <Text style={s.macroStatVal}>{Math.round(val)}</Text>
                      <Text style={s.macroStatLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
                {hasMicros(suggestion.proposal.micros_targets) && (
                  <View style={s.suggestedMicros}>
                    <Text style={s.suggestedMicrosTitle}>Suggested micros targets</Text>
                    {MICROS_FIELDS.filter(({ key }) => (suggestion.proposal.micros_targets?.[key] ?? 0) > 0).map(({ key, label, unit }) => (
                      <View key={key} style={s.suggestedMicroRow}>
                        <Text style={s.suggestedMicroLabel}>{label}</Text>
                        <Text style={s.suggestedMicroVal}>{Math.round(suggestion.proposal.micros_targets![key]!)}{unit}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View style={s.btnRow}>
                <Pressable style={s.btnPrimary} onPress={() => onAccept(suggestion.proposal)}>
                  <Text style={s.btnPrimaryText}>Accept</Text>
                </Pressable>
                <Pressable style={s.btnSecondary} onPress={() => setSuggestion(null)}>
                  <Text style={s.btnSecondaryText}>Edit inputs</Text>
                </Pressable>
                <Pressable style={s.btnSecondary} onPress={onClose}>
                  <Text style={s.btnSecondaryText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// GoalsSetModal (direct edit with micros targets)
// ---------------------------------------------------------------------------

function GoalsSetModal({
  current,
  onClose,
  onSave,
}: {
  current: Goals | null | undefined
  onClose: () => void
  onSave: (g: Goals) => void
}) {
  const [calories, setCalories] = useState(String(current?.calories ?? ''))
  const [protein, setProtein] = useState(String(current?.protein_g ?? ''))
  const [carbs, setCarbs] = useState(String(current?.carbs_g ?? ''))
  const [fat, setFat] = useState(String(current?.fat_g ?? ''))
  const [microsVals, setMicrosVals] = useState<Partial<Record<keyof Micros, string>>>(
    current?.micros_targets
      ? Object.fromEntries(
          MICROS_FIELDS.map(({ key }) => [key, String(current.micros_targets![key] ?? '')])
        ) as Partial<Record<keyof Micros, string>>
      : {}
  )

  const handleSave = () => {
    const anyMicro = MICROS_FIELDS.some(({ key }) => Number(microsVals[key] ?? 0) > 0)
    const micros_targets: Micros | undefined = anyMicro
      ? Object.fromEntries(MICROS_FIELDS.map(({ key }) => [key, Number(microsVals[key] ?? 0)])) as unknown as Micros
      : undefined
    onSave({
      calories: Number(calories),
      protein_g: Number(protein),
      carbs_g: Number(carbs),
      fat_g: Number(fat),
      ...(micros_targets ? { micros_targets } : {}),
    })
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={Keyboard.dismiss}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={s.sheetScroll} contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled">
          <Text style={s.sheetTitle}>Set daily goals</Text>
          <View style={s.macroRow}>
            {([
              { label: 'kcal', val: calories, set: setCalories },
              { label: 'protein', val: protein, set: setProtein },
              { label: 'carbs', val: carbs, set: setCarbs },
              { label: 'fat', val: fat, set: setFat },
            ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
              <View key={label} style={s.macroInput}>
                <Text style={s.fieldLabel}>{label}</Text>
                <TextInput
                  style={s.macroNumInput}
                  value={val}
                  onChangeText={set}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.gray400}
                />
              </View>
            ))}
          </View>
          <MicrosTargetsSection
            values={microsVals}
            onChange={(k, v) => setMicrosVals((prev) => ({ ...prev, [k]: v }))}
          />
          <View style={[s.btnRow, { marginTop: spacing.md }]}>
            <Pressable style={s.btnPrimary} onPress={handleSave}>
              <Text style={s.btnPrimaryText}>Save goals</Text>
            </Pressable>
            <Pressable style={s.btnSecondary} onPress={onClose}>
              <Text style={s.btnSecondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// FavoritesModal
// ---------------------------------------------------------------------------

function FavoritesModal({
  onClose,
  onLog,
}: {
  onClose: () => void
  onLog: (favId: string) => void
}) {
  const { data: favorites = [], isLoading } = useQuery<Favorite[]>({
    queryKey: ['favorites'],
    queryFn: () => nutritionApi.favorites.list(),
  })

  const sorted = [...favorites].sort((a, b) => {
    if (!a.last_used_at) return 1
    if (!b.last_used_at) return -1
    return b.last_used_at.localeCompare(a.last_used_at)
  })

  return (
    <Modal visible transparent animationType="slide" onRequestClose={Keyboard.dismiss}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[s.sheet, { maxHeight: '70%' }]}>
          <Text style={s.sheetTitle}>Favorites</Text>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
          ) : sorted.length === 0 ? (
            <Text style={s.empty}>
              Save your recurring meals as favorites to log them in one tap.
            </Text>
          ) : (
            <FlatList
              data={sorted}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <Pressable style={s.favRow} onPress={() => onLog(item.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.favName}>{item.name}</Text>
                    {item.serving ? (
                      <Text style={s.favMeta}>{item.serving}</Text>
                    ) : null}
                  </View>
                  <Text style={s.favKcal}>{Math.round(item.macros.calories)} kcal</Text>
                </Pressable>
              )}
              ItemSeparatorComponent={() => <View style={s.separator} />}
            />
          )}

          <Pressable style={[s.btnSecondary, { marginTop: spacing.md }]} onPress={onClose}>
            <Text style={s.btnSecondaryText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

class NutritionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('Nutrition crash:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Nutrition screen error</Text>
          <Text selectable style={{ fontFamily: 'Courier', fontSize: 12, color: '#b91c1c' }}>
            {String(this.state.error.message || this.state.error)}
          </Text>
          <Text selectable style={{ fontFamily: 'Courier', fontSize: 11, color: '#6b7280', marginTop: 8 }}>
            {(this.state.error.stack || '').split('\n').slice(0, 8).join('\n')}
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: 12, backgroundColor: '#3b82f6', borderRadius: 8 }}
          >
            <Text style={{ color: 'white', textAlign: 'center', fontWeight: '500' }}>Try again</Text>
          </Pressable>
        </View>
      )
    }
    return this.props.children as React.ReactElement
  }
}

function NutritionScreenInner() {
  const today = toLocalISODate()
  const [date, setDate] = useState(today)
  const [estimating, setEstimating] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showRecipes, setShowRecipes] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [goalsModalOpen, setGoalsModalOpen] = useState(false)
  const [menuLog, setMenuLog] = useState<FoodLog | null>(null)
  const [editLog, setEditLog] = useState<FoodLog | null>(null)
  const [showBarcode, setShowBarcode] = useState(false)

  const qc = useQueryClient()
  const router = useRouter()
  const isToday = date === today

  const { data: dayLogs, isLoading: loadingLogs } = useQuery<DayLogs>({
    queryKey: ['day-logs', date],
    queryFn: () => nutritionApi.logs.list(date),
  })

  const { data: goals } = useQuery<Goals | null>({
    queryKey: ['goals'],
    queryFn: () => nutritionApi.goals.get(),
  })

  const totals = dayLogs?.totals ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const microsTotals = dayLogs?.micros_totals
  const logs = dayLogs?.items ?? []

  // Group by meal_type first, then time heuristic
  const grouped: Partial<Record<typeof MEAL_ORDER[number], FoodLog[]>> = {}
  for (const log of logs) {
    const g = mealGroup(log)
    if (!grouped[g]) grouped[g] = []
    grouped[g]!.push(log)
  }

  // ---------------------------------------------------------------------------
  // Camera / photo library
  // ---------------------------------------------------------------------------

  const handleCamera = () => {
    Alert.alert(
      'Log a photo',
      '',
      [
        {
          text: 'Take Photo',
          onPress: () => { void pickImage('camera') },
        },
        {
          text: 'Choose from Library',
          onPress: () => { void pickImage('library') },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  const pickImage = async (source: 'camera' | 'library') => {
    let result: ImagePicker.ImagePickerResult

    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Permission required', 'Camera access is needed to log meals.')
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
        Alert.alert('Permission required', 'Photo library access is needed to log meals.')
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
    setEstimating(true)

    try {
      // Resize to max 1024px to control AI cost
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      )

      // Get signed upload URL
      const signed = await uploadsApi.signFoodPhoto('image/jpeg')

      // PUT directly to GCS signed URL via expo-file-system (RN fetch+blob
      // is unreliable for file:// binary uploads on iOS)
      const putRes = await FileSystem.uploadAsync(signed.upload_url, manipulated.uri, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      })
      if (putRes.status < 200 || putRes.status >= 300) {
        throw new Error(`Upload failed (${putRes.status})`)
      }

      const est = await nutritionApi.estimatePhoto(signed.public_url)
      setPreview({ estimation: est, source: 'ai_photo' })
    } catch (err) {
      console.warn('photo flow failed', err)
      const e = err as { response?: { data?: { detail?: string } }; message?: string }
      const detail = e?.response?.data?.detail ?? e?.message ?? 'Try again.'
      Alert.alert('Error', `Could not process photo. ${detail}`)
    } finally {
      setEstimating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Log from favorite
  // ---------------------------------------------------------------------------

  const handleLogFavorite = async (favId: string) => {
    setShowFavorites(false)
    try {
      await nutritionApi.favorites.log(favId, date)
      void qc.invalidateQueries({ queryKey: ['day-logs', date] })
      void qc.invalidateQueries({ queryKey: ['favorites'] })
    } catch {
      Alert.alert('Error', 'Could not log favorite')
    }
  }

  // ---------------------------------------------------------------------------
  // Barcode scan
  // ---------------------------------------------------------------------------

  const handleBarcode = async (code: string) => {
    setShowBarcode(false)
    setEstimating(true)
    try {
      const est = await nutritionApi.barcode(code)
      setPreview({ estimation: est, source: 'ai_text' })
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        // Backend tried OFF + USDA and missed. Ask the user to type a name and
        // run the text AI estimator on what they type.
        Alert.prompt(
          'Barcode not in our database',
          "Type the product name and we'll estimate macros from that.",
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Estimate',
              onPress: async (name?: string) => {
                const q = (name ?? '').trim()
                if (!q) return
                setEstimating(true)
                try {
                  const est = await nutritionApi.estimateText(q)
                  setPreview({ estimation: est, source: 'ai_text' })
                } catch {
                  Alert.alert('Error', 'Could not estimate. Try again.')
                } finally {
                  setEstimating(false)
                }
              },
            },
          ],
          'plain-text',
        )
      } else {
        Alert.alert('Error', 'Could not look up barcode. Try again.')
      }
    } finally {
      setEstimating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Per-row actions
  // ---------------------------------------------------------------------------

  const openRowMenu = (log: FoodLog) => {
    Alert.alert(log.name, '', [
      {
        text: 'Edit',
        onPress: () => setEditLog(log),
      },
      {
        text: 'Save as favorite',
        onPress: () => { void handleSaveAsFavorite(log) },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => { void handleDelete(log.id) },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
    setMenuLog(null)
  }

  const handleDelete = async (id: string) => {
    try {
      await nutritionApi.logs.remove(id)
      void qc.invalidateQueries({ queryKey: ['day-logs', date] })
    } catch {
      Alert.alert('Error', 'Could not delete log')
    }
  }

  const handleSaveAsFavorite = async (log: FoodLog) => {
    try {
      await nutritionApi.favorites.create({ name: log.name, serving: log.serving, macros: log.macros })
      void qc.invalidateQueries({ queryKey: ['favorites'] })
    } catch {
      Alert.alert('Error', 'Could not save favorite')
    }
  }

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------

  const handleAcceptGoals = async (g: Goals) => {
    setSuggestOpen(false)
    try {
      await nutritionApi.goals.set(g)
      void qc.invalidateQueries({ queryKey: ['goals'] })
    } catch {
      Alert.alert('Error', 'Could not save goals')
    }
  }

  const handleSaveGoals = async (g: Goals) => {
    setGoalsModalOpen(false)
    try {
      await nutritionApi.goals.set(g)
      void qc.invalidateQueries({ queryKey: ['goals'] })
    } catch {
      Alert.alert('Error', 'Could not save goals')
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* Date strip */}
      <View style={[card, s.dateStrip]}>
        <Pressable
          onPress={() => {
            setDate(prevDate(date))
            setPreview(null)
          }}
          style={s.dateBtn}
        >
          <Text style={s.dateBtnText}>{'< Prev'}</Text>
        </Pressable>
        <Text style={s.dateLabel}>{formatDate(date)}</Text>
        <Pressable
          onPress={() => {
            if (!isToday) {
              setDate(nextDate(date))
              setPreview(null)
            }
          }}
          style={s.dateBtn}
          disabled={isToday}
        >
          <Text style={[s.dateBtnText, isToday && { color: colors.gray200 }]}>{'Next >'}</Text>
        </Pressable>
      </View>

      {/* Totals card */}
      <View style={[card, s.cardPad]}>
        <View style={s.row}>
          <Text style={s.sectionTitle}>Today's nutrition</Text>
          <Text style={s.kcalTotal}>{Math.round(totals.calories)} kcal</Text>
        </View>

        {goals ? (
          <>
            <View style={s.calorieBarRow}>
              <View style={s.calorieBarBg}>
                <View
                  style={[
                    s.calorieBarFill,
                    { width: `${Math.min(100, (totals.calories / goals.calories) * 100)}%` as unknown as number },
                  ]}
                />
              </View>
              <Text style={s.goalLabel}>{Math.round(goals.calories)} goal</Text>
            </View>
            <View style={s.macrosRow}>
              <MacroBar value={totals.protein_g} goal={goals.protein_g} label="protein" />
              <MacroBar value={totals.carbs_g} goal={goals.carbs_g} label="carbs" />
              <MacroBar value={totals.fat_g} goal={goals.fat_g} label="fat" />
            </View>
            {/* Micros today */}
            <MicrosPanel
              micros={microsTotals}
              source={null}
              targets={goals.micros_targets}
            />
          </>
        ) : (
          <>
            <View style={s.macroTextRow}>
              <Text style={s.macroText}>P: {Math.round(totals.protein_g)}g</Text>
              <Text style={s.macroText}>C: {Math.round(totals.carbs_g)}g</Text>
              <Text style={s.macroText}>F: {Math.round(totals.fat_g)}g</Text>
            </View>
            <Text style={s.empty}>No goals set. Set them to track progress.</Text>
          </>
        )}
      </View>

      {/* Estimating indicator */}
      {estimating && (
        <View style={[card, s.cardPad, s.row]}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={[s.meta, { marginLeft: spacing.sm }]}>Estimating...</Text>
        </View>
      )}

      {/* Composer */}
      {!estimating && (
        <View style={[card, s.cardPad]}>
          <Text style={s.sectionTitle}>Log food</Text>

          {/* Primary add button */}
          <Pressable
            style={s.addFoodBtn}
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
        </View>
      )}

      {/* Day log list */}
      <View style={{ gap: spacing.md }}>
        {loadingLogs ? (
          <View style={[card, { height: 80, backgroundColor: colors.gray100 }]} />
        ) : logs.length === 0 ? (
          <View style={[card, s.cardPad]}>
            <Text style={s.empty}>
              No food logged yet. Snap a photo or type a meal to start.
            </Text>
          </View>
        ) : (
          MEAL_ORDER.filter((g) => (grouped[g]?.length ?? 0) > 0).map((group) => (
            <View key={group} style={[card, s.cardPad]}>
              <Text style={s.groupLabel}>{group}</Text>
              {grouped[group]!.map((log, idx) => (
                <Pressable
                  key={log.id}
                  style={[s.logRow, idx < grouped[group]!.length - 1 && s.logRowBorder]}
                  onPress={() => openRowMenu(log)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.logName} numberOfLines={1}>{log.name}</Text>
                    <Text style={s.logMeta}>
                      {log.serving ? `${log.serving} - ` : ''}
                      {Math.round(log.macros.calories)} kcal | P {Math.round(log.macros.protein_g)}g C {Math.round(log.macros.carbs_g)}g F {Math.round(log.macros.fat_g)}g
                    </Text>
                  </View>
                  <Text style={s.logMenuDot}>...</Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </View>

      {/* Goals card */}
      <View style={[card, s.cardPad]}>
        <View style={s.row}>
          <Text style={s.sectionTitle}>Daily goals</Text>
          <View style={s.goalsActions}>
            <Pressable onPress={() => setSuggestOpen(true)}>
              <Text style={s.suggestBtn}>Suggest with AI</Text>
            </Pressable>
            <Pressable onPress={() => setGoalsModalOpen(true)} style={{ marginLeft: spacing.md }}>
              <Text style={[s.suggestBtn, { color: colors.gray500 }]}>Edit</Text>
            </Pressable>
          </View>
        </View>

        {goals ? (
          <View style={[s.macroRow, { marginTop: spacing.sm }]}>
            {([
              ['kcal', goals.calories],
              ['protein', goals.protein_g],
              ['carbs', goals.carbs_g],
              ['fat', goals.fat_g],
            ] as [string, number][]).map(([label, val]) => (
              <View key={label} style={s.macroStatItem}>
                <Text style={s.macroStatVal}>{Math.round(val)}</Text>
                <Text style={s.macroStatLabel}>{label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[s.empty, { marginTop: spacing.sm }]}>
            No goals set. Set them to track progress.
          </Text>
        )}
      </View>

      {/* Modals */}
      {preview && (
        <PreviewModal
          state={preview}
          date={date}
          onSaved={() => setPreview(null)}
          onCancel={() => setPreview(null)}
        />
      )}

      <FoodEditSheet
        visible={!!editLog}
        hit={editLog ? {
          name: editLog.name,
          serving: editLog.serving,
          macros: editLog.macros,
          micros: (editLog.micros as unknown as Record<string, number>) ?? null,
          source: 'manual',
        } : null}
        date={editLog?.date ?? date}
        editLogId={editLog?.id ?? null}
        initialMealType={editLog?.meal_type as MealType | undefined}
        initialLoggedAt={editLog?.logged_at ?? null}
        onClose={() => setEditLog(null)}
        onLogged={() => setEditLog(null)}
      />

      {showFavorites && (
        <FavoritesModal
          onClose={() => setShowFavorites(false)}
          onLog={(id) => { void handleLogFavorite(id) }}
        />
      )}

      {showRecipes && (
        <RecipePickerModal
          date={date}
          onClose={() => setShowRecipes(false)}
          onLogged={() => {
            setShowRecipes(false)
            void qc.invalidateQueries({ queryKey: ['day-logs', date] })
            void qc.invalidateQueries({ queryKey: ['dashboard'] })
          }}
        />
      )}

      {suggestOpen && (
        <GoalsSuggestModal
          onClose={() => setSuggestOpen(false)}
          onAccept={(g) => { void handleAcceptGoals(g) }}
        />
      )}

      {goalsModalOpen && (
        <GoalsSetModal
          current={goals}
          onClose={() => setGoalsModalOpen(false)}
          onSave={(g) => { void handleSaveGoals(g) }}
        />
      )}

      {/* Invisible sentinel for menuLog (unused var) */}
      {menuLog !== null && null}

      {/* Barcode scanner modal */}
      <BarcodeScanner
        visible={showBarcode}
        onCode={(code) => { void handleBarcode(code) }}
        onCancel={() => setShowBarcode(false)}
      />

    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: 48 },
  cardPad: { padding: spacing.base },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textSecondary },
  empty: { fontSize: 14, color: colors.gray400, marginTop: spacing.sm },

  // Date strip
  dateStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  dateBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  dateBtnText: { fontSize: 14, fontWeight: '500', color: colors.gray500 },
  dateLabel: { fontSize: 14, fontWeight: '600', color: colors.text },

  // Totals
  kcalTotal: { fontSize: 18, fontWeight: '700', color: colors.primary },
  calorieBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  calorieBarBg: { flex: 1, height: 10, borderRadius: radius.full, backgroundColor: colors.gray100, overflow: 'hidden' },
  calorieBarFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.primary },
  goalLabel: { fontSize: 11, color: colors.gray400 },
  macrosRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  macroBarHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  macroLabel: { fontSize: 11, color: colors.gray500 },
  macroValue: { fontSize: 11, color: colors.gray400 },
  macroBarBg: { height: 8, borderRadius: radius.full, backgroundColor: colors.gray100, overflow: 'hidden' },
  macroBarFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.primary },
  macroTextRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  macroText: { fontSize: 13, color: colors.gray500 },

  // Meal type chips
  mealChipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: spacing.sm },
  mealChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mealChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  mealChipText: { fontSize: 12, color: colors.gray600, fontWeight: '500' },
  mealChipTextActive: { color: '#fff' },

  // Time inputs
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  timeLabel: { fontSize: 12, color: colors.gray500, marginRight: 4 },
  timeInput: {
    width: 40,
    height: 32,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    textAlign: 'center',
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  timeColon: { fontSize: 14, color: colors.gray500 },
  timePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.gray50,
  },
  timePillText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  timeDone: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6 },
  timeDoneText: { color: colors.primary, fontWeight: '600' },

  // Micros panel
  microsPanel: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray100, paddingTop: spacing.sm },
  microsPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  microsPanelTitle: { fontSize: 12, fontWeight: '600', color: colors.gray500 },
  usdaBadge: { backgroundColor: '#dbeafe', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  usdaBadgeText: { fontSize: 10, fontWeight: '700', color: '#1d4ed8' },
  microsList: { marginTop: spacing.sm, gap: spacing.sm },
  microRow: { flex: 1 },
  microRowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  microRowLabel: { fontSize: 11, color: colors.gray500 },
  microRowVal: { fontSize: 11, color: colors.gray400 },
  microBarBg: { height: 4, borderRadius: radius.full, backgroundColor: colors.gray100, overflow: 'hidden' },
  microBarFill: { height: '100%', borderRadius: radius.full, backgroundColor: '#2dd4bf' },

  // Micros targets section
  microsTargetsSection: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray100, paddingTop: spacing.sm },
  microsTargetsGrid: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  microsTargetField: { width: '47%' },
  microsTargetLabel: { fontSize: 11, color: colors.gray500, marginBottom: 2 },
  microsTargetInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surface,
  },

  // Suggested micros
  suggestedMicros: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray200, paddingTop: spacing.sm },
  suggestedMicrosTitle: { fontSize: 12, fontWeight: '600', color: colors.gray500, marginBottom: 4 },
  suggestedMicroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  suggestedMicroLabel: { fontSize: 12, color: colors.gray500 },
  suggestedMicroVal: { fontSize: 12, fontWeight: '500', color: colors.text },

  // Composer
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
  composerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  composerBtnText: { fontSize: 12, color: colors.gray700, fontWeight: '500', textAlign: 'center' },
  composerBtnIcon: { flexDirection: 'column', gap: 4, paddingVertical: 8 },

  // Inputs
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

  // Buttons
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.gray600, fontSize: 14, fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },

  // Log list
  groupLabel: { fontSize: 11, fontWeight: '600', color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  logRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  logName: { fontSize: 14, fontWeight: '500', color: colors.text },
  logMeta: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  logMenuDot: { fontSize: 18, color: colors.gray400, lineHeight: 22 },

  // Goals card
  goalsActions: { flexDirection: 'row', alignItems: 'center' },
  suggestBtn: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  macroRow: { flexDirection: 'row', gap: spacing.sm },
  macroInput: { flex: 1, alignItems: 'center', gap: 4 },
  macroNumInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  macroStatItem: { flex: 1, alignItems: 'center', backgroundColor: colors.gray50, borderRadius: radius.md, paddingVertical: spacing.sm },
  macroStatVal: { fontSize: 14, fontWeight: '600', color: colors.text },
  macroStatLabel: { fontSize: 11, color: colors.gray400 },

  // Modal / sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetScroll: { maxHeight: '90%' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.base, gap: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  confidenceChip: { backgroundColor: colors.gray100, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  confidenceText: { fontSize: 11, color: colors.gray500 },

  // Favorites
  favRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  favName: { fontSize: 14, fontWeight: '500', color: colors.text },
  favMeta: { fontSize: 12, color: colors.gray400, marginTop: 1 },
  favKcal: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  separator: { height: 1, backgroundColor: colors.gray100 },

  // Suggest modal
  fieldLabel: { fontSize: 12, color: colors.gray500 },
  suggestionBox: { backgroundColor: colors.gray50, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  suggestionRationale: { fontSize: 12, color: colors.gray500, fontStyle: 'italic' },

  // Food autocomplete suggestions panel
  suggestionList: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, maxHeight: 260 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  suggestionName: { fontSize: 14, fontWeight: '500', color: colors.text },
  suggestionServing: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  suggestionRight: { alignItems: 'flex-end', gap: 4 },
  suggestionKcal: { fontSize: 12, fontWeight: '500', color: colors.primary },
  sourceChip: { borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 },
  sourceChipFav: { backgroundColor: '#fef3c7' },
  sourceChipRecent: { backgroundColor: colors.gray100 },
  sourceChipText: { fontSize: 10 },
  sourceChipTextFav: { color: '#92400e' },
  sourceChipTextRecent: { color: colors.gray500 },
  noMatchBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noMatchText: { fontSize: 12, color: colors.gray400 },
  // Recipe picker modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  modalClose: { color: colors.gray500, fontSize: 14 },
  recipePickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recipePickRowActive: {
    backgroundColor: '#EBF3FF',
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  recipePickName: { fontSize: 14, fontWeight: '600', color: colors.text },
  recipePickMeta: { fontSize: 12, color: colors.gray500, marginTop: 2 },
  recipePickCheck: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  recipeServingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  recipeServingsLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  recipeServingsInput: {
    width: 80,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
  recipeScaledMeta: {
    fontSize: 12,
    color: colors.gray500,
    paddingHorizontal: spacing.base,
    fontVariant: ['tabular-nums'],
  },
  recipeLogBtn: {
    margin: spacing.base,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  recipeLogBtnDisabled: { opacity: 0.4 },
  recipeLogBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  recipeAddBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  recipeAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})

export default function NutritionScreen() {
  return (
    <NutritionErrorBoundary>
      <NutritionScreenInner />
    </NutritionErrorBoundary>
  )
}

// ---------------------------------------------------------------------------
// Recipe picker — pick a saved recipe + servings, log it as a FoodLog
// ---------------------------------------------------------------------------

function RecipePickerModal({
  date,
  onClose,
  onLogged,
}: {
  date: string
  onClose: () => void
  onLogged: () => void
}) {
  const router = useRouter()
  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
  })

  const [picked, setPicked] = useState<string | null>(null)
  const [servings, setServings] = useState('1')
  const [saving, setSaving] = useState(false)

  // Auto-select the first recipe when the list arrives so the user can hit
  // Log without an extra tap. If they have multiple, they can still re-pick.
  useEffect(() => {
    if (recipes && recipes.length > 0 && picked === null) {
      setPicked(recipes[0].id)
    }
  }, [recipes, picked])

  const handleLog = async () => {
    if (!picked) return
    const n = parseFloat(servings)
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Enter servings', 'How many servings did you eat?')
      return
    }
    setSaving(true)
    try {
      await nutritionApi.recipes.log(picked, { date, servings_eaten: n })
      onLogged()
    } catch {
      Alert.alert('Error', 'Could not log recipe.')
    } finally {
      setSaving(false)
    }
  }

  const selected = recipes?.find((r) => r.id === picked) ?? null
  const scaledCals = selected ? Math.round(selected.per_serving_macros.calories * (parseFloat(servings) || 0)) : 0

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Log a recipe</Text>
            <Pressable onPress={onClose}><Text style={s.modalClose}>Close</Text></Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
          ) : !recipes || recipes.length === 0 ? (
            <View style={{ padding: spacing.lg, alignItems: 'center', gap: spacing.md }}>
              <Text style={{ color: colors.gray500, textAlign: 'center' }}>
                No recipes yet. Build one first.
              </Text>
              <Pressable
                style={s.recipeAddBtn}
                onPress={() => { onClose(); router.push('/recipes/new' as never) }}
              >
                <Text style={s.recipeAddBtnText}>+ Create recipe</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
                {recipes.map((r) => {
                  const isPicked = r.id === picked
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => setPicked(r.id)}
                      style={[s.recipePickRow, isPicked && s.recipePickRowActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.recipePickName}>{r.name}</Text>
                        <Text style={s.recipePickMeta}>
                          {r.per_serving_macros.calories} kcal/serving · {r.ingredients.length} ingredients
                        </Text>
                      </View>
                      {isPicked ? <Text style={s.recipePickCheck}>✓</Text> : null}
                    </Pressable>
                  )
                })}
              </ScrollView>

              <View style={s.recipeServingsRow}>
                <Text style={s.recipeServingsLabel}>Servings eaten</Text>
                <TextInput
                  style={s.recipeServingsInput}
                  value={servings}
                  onChangeText={setServings}
                  keyboardType="decimal-pad"
                  placeholder="1"
                />
              </View>
              {selected ? (
                <Text style={s.recipeScaledMeta}>
                  = {scaledCals} kcal · {fmtNum(selected.per_serving_macros.protein_g * (parseFloat(servings) || 0))}g P ·{' '}
                  {fmtNum(selected.per_serving_macros.carbs_g * (parseFloat(servings) || 0))}g C ·{' '}
                  {fmtNum(selected.per_serving_macros.fat_g * (parseFloat(servings) || 0))}g F
                </Text>
              ) : null}

              <Pressable
                style={[s.recipeLogBtn, (!picked || saving) && s.recipeLogBtnDisabled]}
                onPress={() => void handleLog()}
                disabled={!picked || saving}
              >
                <Text style={s.recipeLogBtnText}>{saving ? 'Logging...' : 'Log to today'}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10
  return r === Math.floor(r) ? String(r) : r.toFixed(1)
}
