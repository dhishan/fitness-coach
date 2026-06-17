/**
 * Recipe editor. Path `/recipes/new` creates a new one; `/recipes/<id>`
 * loads an existing recipe for editing.
 *
 * One row per ingredient. Each row captures: name, serving_label, servings_used,
 * and the per-serving macros (cal/protein/carbs/fat) read straight off the label.
 * Micros are collapsed behind an "More nutrients" disclosure to keep the row
 * compact for the common case.
 *
 * Totals + per-serving previews update live as you edit.
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Recipe, RecipeIngredient } from '@fitness/shared-types'
import { nutritionApi } from '../../src/services/api'
import { colors, radius, spacing } from '../../src/theme'

type IngredientForm = RecipeIngredient & { _key: string }

function emptyIngredient(): IngredientForm {
  return {
    _key: Math.random().toString(36).slice(2),
    name: '',
    serving_label: '1 serving',
    servings_used: 1,
    calories_per_serving: 0,
    protein_g_per_serving: 0,
    carbs_g_per_serving: 0,
    fat_g_per_serving: 0,
  }
}

export default function RecipeEditor() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const isNew = id === 'new'

  const { data: existing, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => nutritionApi.recipes.get(id),
    enabled: !isNew,
  })

  const [name, setName] = useState('')
  const [yields, setYields] = useState('1')
  const [notes, setNotes] = useState('')
  const [ingredients, setIngredients] = useState<IngredientForm[]>([emptyIngredient()])

  // Hydrate once when existing loads
  useEffect(() => {
    if (existing && !isNew) {
      setName(existing.name)
      setYields(String(existing.yields_servings))
      setNotes(existing.notes ?? '')
      setIngredients(
        existing.ingredients.map((i) => ({
          ...i,
          _key: Math.random().toString(36).slice(2),
        })),
      )
    }
  }, [existing, isNew])

  const updateIngredient = (key: string, patch: Partial<IngredientForm>) => {
    setIngredients((prev) =>
      prev.map((i) => (i._key === key ? { ...i, ...patch } : i)),
    )
  }

  const removeIngredient = (key: string) => {
    setIngredients((prev) => prev.filter((i) => i._key !== key))
  }

  const addIngredient = () => {
    setIngredients((prev) => [...prev, emptyIngredient()])
  }

  // Live totals preview
  const yieldsNum = Math.max(0.0001, parseFloat(yields) || 1)
  const previewTotals = computeLocalTotals(ingredients, yieldsNum)

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        yields_servings: yieldsNum,
        ingredients: ingredients
          .filter((i) => i.name.trim() && i.servings_used > 0)
          .map(({ _key: _, ...rest }) => rest),
        notes: notes.trim(),
      }
      if (isNew) return nutritionApi.recipes.create(body)
      return nutritionApi.recipes.update(id, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipes'] })
      void qc.invalidateQueries({ queryKey: ['recipe', id] })
      router.back()
    },
    onError: () => Alert.alert('Error', 'Could not save recipe. Try again.'),
  })

  const deleteMut = useMutation({
    mutationFn: () => nutritionApi.recipes.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipes'] })
      router.back()
    },
    onError: () => Alert.alert('Error', 'Could not delete recipe.'),
  })

  const confirmDelete = () => {
    Alert.alert('Delete recipe?', `"${name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMut.mutate(),
      },
    ])
  }

  const canSave =
    name.trim().length > 0 &&
    yieldsNum > 0 &&
    ingredients.some((i) => i.name.trim() && i.servings_used > 0)

  if (!isNew && isLoading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 70 : 0}
    >
      <Stack.Screen
        options={{
          title: isNew ? 'New recipe' : 'Edit recipe',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => saveMut.mutate()}
              disabled={!canSave || saveMut.isPending}
              style={s.headerBtn}
            >
              <Text
                style={[
                  s.headerBtnText,
                  (!canSave || saveMut.isPending) && { opacity: 0.4 },
                ]}
              >
                {saveMut.isPending ? '...' : 'Save'}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView
        style={s.screen}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header — name + yields + notes */}
        <View style={[s.card, { gap: spacing.md }]}>
          <Field label="Name">
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Berry Shake"
              placeholderTextColor={colors.gray400}
            />
          </Field>
          <Field label="Yields (servings)">
            <TextInput
              style={s.input}
              value={yields}
              onChangeText={setYields}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.gray400}
            />
          </Field>
          <Field label="Notes (optional)">
            <TextInput
              style={[s.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything to remember..."
              placeholderTextColor={colors.gray400}
              multiline
            />
          </Field>
        </View>

        {/* Totals preview */}
        <View style={[s.card, s.previewCard]}>
          <Text style={s.previewLabel}>Per serving</Text>
          <View style={s.previewRow}>
            <PreviewStat label="kcal" value={previewTotals.per.calories} />
            <PreviewStat
              label="protein"
              value={previewTotals.per.protein_g}
              unit="g"
            />
            <PreviewStat
              label="carbs"
              value={previewTotals.per.carbs_g}
              unit="g"
            />
            <PreviewStat label="fat" value={previewTotals.per.fat_g} unit="g" />
          </View>
          <Text style={s.previewMeta}>
            Total: {previewTotals.total.calories} kcal ·{' '}
            {fmt(previewTotals.total.protein_g)}g P ·{' '}
            {fmt(previewTotals.total.carbs_g)}g C ·{' '}
            {fmt(previewTotals.total.fat_g)}g F
          </Text>
        </View>

        {/* Ingredients */}
        <Text style={s.sectionTitle}>Ingredients</Text>
        {ingredients.map((ing, idx) => (
          <IngredientCard
            key={ing._key}
            index={idx}
            ingredient={ing}
            onChange={(patch) => updateIngredient(ing._key, patch)}
            onRemove={
              ingredients.length > 1 ? () => removeIngredient(ing._key) : undefined
            }
          />
        ))}

        <TouchableOpacity style={s.addIngBtn} onPress={addIngredient}>
          <Text style={s.addIngBtnText}>+ Add ingredient</Text>
        </TouchableOpacity>

        {!isNew && (
          <TouchableOpacity style={s.deleteBtn} onPress={confirmDelete}>
            <Text style={s.deleteBtnText}>Delete recipe</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

function PreviewStat({
  label,
  value,
  unit,
}: {
  label: string
  value: number
  unit?: string
}) {
  return (
    <View style={s.previewStat}>
      <Text style={s.previewVal}>
        {fmt(value)}
        {unit ?? ''}
      </Text>
      <Text style={s.previewSub}>{label}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// One ingredient row
// ---------------------------------------------------------------------------

function IngredientCard({
  index,
  ingredient,
  onChange,
  onRemove,
}: {
  index: number
  ingredient: IngredientForm
  onChange: (patch: Partial<IngredientForm>) => void
  onRemove?: () => void
}) {
  const [showMicros, setShowMicros] = useState(false)
  return (
    <View style={s.ingCard}>
      <View style={s.ingHeader}>
        <Text style={s.ingHeaderText}>Ingredient {index + 1}</Text>
        {onRemove ? (
          <TouchableOpacity onPress={onRemove}>
            <Text style={s.removeText}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Field label="Name">
        <TextInput
          style={s.input}
          value={ingredient.name}
          onChangeText={(t) => onChange({ name: t })}
          placeholder="e.g. Ascent Whey"
          placeholderTextColor={colors.gray400}
        />
      </Field>

      <View style={s.row2}>
        <View style={{ flex: 2 }}>
          <Field label="Serving size">
            <TextInput
              style={s.input}
              value={ingredient.serving_label}
              onChangeText={(t) => onChange({ serving_label: t })}
              placeholder="1 scoop (31g)"
              placeholderTextColor={colors.gray400}
            />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="How many?">
            <TextInput
              style={s.input}
              value={String(ingredient.servings_used)}
              onChangeText={(t) =>
                onChange({ servings_used: parseFloat(t) || 0 })
              }
              keyboardType="decimal-pad"
            />
          </Field>
        </View>
      </View>

      <Text style={s.sectionSub}>Per single serving (from the label)</Text>
      <View style={s.row4}>
        <NumberField
          label="Calories"
          value={ingredient.calories_per_serving}
          onChange={(v) => onChange({ calories_per_serving: v })}
        />
        <NumberField
          label="Protein g"
          value={ingredient.protein_g_per_serving}
          onChange={(v) => onChange({ protein_g_per_serving: v })}
        />
        <NumberField
          label="Carbs g"
          value={ingredient.carbs_g_per_serving}
          onChange={(v) => onChange({ carbs_g_per_serving: v })}
        />
        <NumberField
          label="Fat g"
          value={ingredient.fat_g_per_serving}
          onChange={(v) => onChange({ fat_g_per_serving: v })}
        />
      </View>

      <Pressable
        onPress={() => setShowMicros((v) => !v)}
        style={s.discloseBtn}
      >
        <Text style={s.discloseText}>
          {showMicros ? '▾ Hide micros' : '▸ More nutrients (optional)'}
        </Text>
      </Pressable>
      {showMicros ? (
        <View style={s.microsGrid}>
          <NumberField
            label="Fiber g"
            value={ingredient.fiber_g_per_serving ?? 0}
            onChange={(v) => onChange({ fiber_g_per_serving: v })}
          />
          <NumberField
            label="Sugar g"
            value={ingredient.sugar_g_per_serving ?? 0}
            onChange={(v) => onChange({ sugar_g_per_serving: v })}
          />
          <NumberField
            label="Sat fat g"
            value={ingredient.saturated_fat_g_per_serving ?? 0}
            onChange={(v) => onChange({ saturated_fat_g_per_serving: v })}
          />
          <NumberField
            label="Chol mg"
            value={ingredient.cholesterol_mg_per_serving ?? 0}
            onChange={(v) => onChange({ cholesterol_mg_per_serving: v })}
          />
          <NumberField
            label="Sodium mg"
            value={ingredient.sodium_mg_per_serving ?? 0}
            onChange={(v) => onChange({ sodium_mg_per_serving: v })}
          />
          <NumberField
            label="Potassium mg"
            value={ingredient.potassium_mg_per_serving ?? 0}
            onChange={(v) => onChange({ potassium_mg_per_serving: v })}
          />
          <NumberField
            label="Calcium mg"
            value={ingredient.calcium_mg_per_serving ?? 0}
            onChange={(v) => onChange({ calcium_mg_per_serving: v })}
          />
          <NumberField
            label="Iron mg"
            value={ingredient.iron_mg_per_serving ?? 0}
            onChange={(v) => onChange({ iron_mg_per_serving: v })}
          />
          <NumberField
            label="Vit C mg"
            value={ingredient.vitamin_c_mg_per_serving ?? 0}
            onChange={(v) => onChange({ vitamin_c_mg_per_serving: v })}
          />
          <NumberField
            label="Vit D mcg"
            value={ingredient.vitamin_d_mcg_per_serving ?? 0}
            onChange={(v) => onChange({ vitamin_d_mcg_per_serving: v })}
          />
        </View>
      ) : null}
    </View>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <View style={{ flex: 1, minWidth: 78, gap: 2 }}>
      <Text style={s.fieldLabelSm}>{label}</Text>
      <TextInput
        style={s.numInput}
        value={value === 0 ? '' : String(value)}
        onChangeText={(t) => onChange(parseFloat(t) || 0)}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.gray400}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Local math (mirror of backend recipe_service.compute_totals)
// ---------------------------------------------------------------------------

function computeLocalTotals(
  ingredients: IngredientForm[],
  yieldsServings: number,
): {
  total: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  per: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
} {
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  for (const i of ingredients) {
    const u = i.servings_used || 0
    if (u <= 0) continue
    totals.calories += (i.calories_per_serving || 0) * u
    totals.protein_g += (i.protein_g_per_serving || 0) * u
    totals.carbs_g += (i.carbs_g_per_serving || 0) * u
    totals.fat_g += (i.fat_g_per_serving || 0) * u
  }
  const safeYields = yieldsServings > 0 ? yieldsServings : 1
  const per = {
    calories: Math.round(totals.calories / safeYields),
    protein_g: round1(totals.protein_g / safeYields),
    carbs_g: round1(totals.carbs_g / safeYields),
    fat_g: round1(totals.fat_g / safeYields),
  }
  return {
    total: {
      calories: Math.round(totals.calories),
      protein_g: round1(totals.protein_g),
      carbs_g: round1(totals.carbs_g),
      fat_g: round1(totals.fat_g),
    },
    per,
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function fmt(n: number): string {
  if (n === Math.floor(n)) return String(n)
  return n.toFixed(1)
}

// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.base, gap: spacing.md, paddingBottom: 64 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { paddingHorizontal: spacing.base },
  headerBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  fieldLabel: {
    fontSize: 11,
    color: colors.gray500,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldLabelSm: {
    fontSize: 10,
    color: colors.gray500,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 40,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  numInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    height: 36,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  sectionSub: {
    fontSize: 11,
    color: colors.gray500,
    marginTop: spacing.xs,
  },
  previewCard: { backgroundColor: '#F7F8FA', borderColor: colors.border },
  previewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.sm,
  },
  previewStat: { alignItems: 'center' },
  previewVal: { fontSize: 18, fontWeight: '700', color: colors.text },
  previewSub: { fontSize: 11, color: colors.gray500, marginTop: 2 },
  previewMeta: {
    fontSize: 11,
    color: colors.gray500,
    marginTop: spacing.sm,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  ingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  ingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ingHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  removeText: { color: colors.error, fontSize: 12, fontWeight: '600' },
  row2: { flexDirection: 'row', gap: spacing.sm },
  row4: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  microsGrid: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  discloseBtn: { paddingVertical: 4 },
  discloseText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  addIngBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addIngBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  deleteBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteBtnText: { color: colors.error, fontSize: 14, fontWeight: '600' },
})
