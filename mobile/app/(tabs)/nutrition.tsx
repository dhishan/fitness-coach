import React, { useState } from 'react'
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
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DayLogs,
  Estimation,
  Favorite,
  FoodLog,
  Goals,
  GoalSuggestion,
  Macros,
} from '@fitness/shared-types'
import { nutritionApi, uploadsApi } from '../../src/services/api'
import { colors, spacing, radius, card } from '../../src/theme'
import { toLocalISODate } from '../../src/lib/dates'

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
// Meal grouping
// ---------------------------------------------------------------------------

function mealGroup(log: FoodLog): 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' {
  if (!log.created_at) return 'Snacks'
  const h = new Date(log.created_at).getHours()
  if (h >= 5 && h < 11) return 'Breakfast'
  if (h >= 11 && h < 15) return 'Lunch'
  if (h >= 17 && h < 22) return 'Dinner'
  return 'Snacks'
}

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const

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
    try {
      if (state.editId) {
        await nutritionApi.logs.update(state.editId, { name, serving, macros })
      } else {
        await nutritionApi.logs.create({ date, name, serving, macros, source: state.source })
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
    <Modal visible transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{state.editId ? 'Edit log' : 'Confirm entry'}</Text>
            <View style={s.confidenceChip}>
              <Text style={s.confidenceText}>{confidence}% confident</Text>
            </View>
          </View>

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
                <Text style={s.macroInputLabel}>{label}</Text>
              </View>
            ))}
          </View>

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
        </View>
      </View>
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
    <Modal visible transparent animationType="slide">
      <View style={s.overlay}>
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
      </View>
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
    <Modal visible transparent animationType="slide">
      <View style={s.overlay}>
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
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type ComposerMode = 'idle' | 'text'

export default function NutritionScreen() {
  const today = toLocalISODate()
  const [date, setDate] = useState(today)
  const [composerMode, setComposerMode] = useState<ComposerMode>('idle')
  const [textInput, setTextInput] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [showFavorites, setShowFavorites] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [menuLog, setMenuLog] = useState<FoodLog | null>(null)

  const qc = useQueryClient()
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
  const logs = dayLogs?.items ?? []

  // Group by meal heuristic
  const grouped: Partial<Record<typeof MEAL_ORDER[number], FoodLog[]>> = {}
  for (const log of logs) {
    const g = mealGroup(log)
    if (!grouped[g]) grouped[g] = []
    grouped[g]!.push(log)
  }

  // ---------------------------------------------------------------------------
  // Text estimation
  // ---------------------------------------------------------------------------

  const handleEstimateText = async () => {
    if (!textInput.trim()) return
    setEstimating(true)
    setComposerMode('idle')
    try {
      const est = await nutritionApi.estimateText(textInput.trim())
      setPreview({ estimation: est, source: 'ai_text' })
      setTextInput('')
    } catch {
      Alert.alert('Error', 'Could not estimate. Try rephrasing.')
    } finally {
      setEstimating(false)
    }
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

      // PUT directly to GCS signed URL - no Authorization header
      const putRes = await fetch(signed.upload_url, {
        method: 'PUT',
        body: await (await fetch(manipulated.uri)).blob(),
        headers: { 'Content-Type': 'image/jpeg' },
      })
      if (!putRes.ok) throw new Error('Upload failed')

      const est = await nutritionApi.estimatePhoto(signed.public_url)
      setPreview({ estimation: est, source: 'ai_photo' })
    } catch {
      Alert.alert('Error', 'Could not process photo. Try again.')
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
  // Per-row actions
  // ---------------------------------------------------------------------------

  const openRowMenu = (log: FoodLog) => {
    Alert.alert(log.name, '', [
      {
        text: 'Edit',
        onPress: () =>
          setPreview({
            estimation: { name: log.name, serving: log.serving, macros: log.macros, confidence: 1 },
            source: 'ai_text',
            editId: log.id,
          }),
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
            setComposerMode('idle')
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
              setComposerMode('idle')
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

          {composerMode === 'idle' && (
            <View style={[s.row, { marginTop: spacing.sm, gap: spacing.sm }]}>
              <Pressable style={s.composerBtn} onPress={() => setComposerMode('text')}>
                <Text style={s.composerBtnText}>[T] Type a meal</Text>
              </Pressable>
              <Pressable style={s.composerBtn} onPress={handleCamera}>
                <Text style={s.composerBtnText}>[C] Camera</Text>
              </Pressable>
              <Pressable style={s.composerBtn} onPress={() => setShowFavorites(true)}>
                <Text style={s.composerBtnText}>[*] Favorites</Text>
              </Pressable>
            </View>
          )}

          {composerMode === 'text' && (
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              <TextInput
                style={[s.input, { height: 64 }]}
                value={textInput}
                onChangeText={setTextInput}
                placeholder="e.g. two scrambled eggs and toast with butter"
                placeholderTextColor={colors.gray400}
                multiline
                autoFocus
              />
              <View style={s.row}>
                <Pressable
                  style={[s.btnPrimary, { flex: 1 }, !textInput.trim() && s.btnDisabled]}
                  onPress={() => { void handleEstimateText() }}
                  disabled={!textInput.trim()}
                >
                  <Text style={s.btnPrimaryText}>Estimate</Text>
                </Pressable>
                <View style={{ width: spacing.sm }} />
                <Pressable
                  style={s.btnSecondary}
                  onPress={() => { setComposerMode('idle'); setTextInput('') }}
                >
                  <Text style={s.btnSecondaryText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}
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
          <Pressable onPress={() => setSuggestOpen(true)}>
            <Text style={s.suggestBtn}>Suggest with AI</Text>
          </Pressable>
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

      {showFavorites && (
        <FavoritesModal
          onClose={() => setShowFavorites(false)}
          onLog={(id) => { void handleLogFavorite(id) }}
        />
      )}

      {suggestOpen && (
        <GoalsSuggestModal
          onClose={() => setSuggestOpen(false)}
          onAccept={(g) => { void handleAcceptGoals(g) }}
        />
      )}

      {/* Invisible sentinel for menuLog (unused var) */}
      {menuLog !== null && null}

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

  // Composer
  composerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  composerBtnText: { fontSize: 12, color: colors.gray700, fontWeight: '500', textAlign: 'center' },

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
  macroInputLabel: { fontSize: 11, color: colors.gray400 },
  macroStatItem: { flex: 1, alignItems: 'center', backgroundColor: colors.gray50, borderRadius: radius.md, paddingVertical: spacing.sm },
  macroStatVal: { fontSize: 14, fontWeight: '600', color: colors.text },
  macroStatLabel: { fontSize: 11, color: colors.gray400 },

  // Modal / sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
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
})
