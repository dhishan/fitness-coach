/**
 * Recipes list. Tap a row to edit, "+" to create a new one.
 */
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter, Stack } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import type { Recipe } from '@fitness/shared-types'
import { nutritionApi } from '../../src/services/api'
import { colors, radius, spacing } from '../../src/theme'

export default function RecipesList() {
  const router = useRouter()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
  })

  return (
    <View style={s.screen}>
      <Stack.Screen
        options={{
          title: 'Recipes',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/recipes/new' as never)}
              style={s.headerBtn}
            >
              <Text style={s.headerBtnText}>+ New</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : !data || data.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No recipes yet</Text>
          <Text style={s.emptyBody}>
            Build your own meals from labeled ingredients. We sum the macros and store
            per-serving totals so you can log a serving with one tap.
          </Text>
          <TouchableOpacity
            style={s.emptyBtn}
            onPress={() => router.push('/recipes/new' as never)}
          >
            <Text style={s.emptyBtnText}>+ Create your first recipe</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.list}
          onRefresh={() => void refetch()}
          refreshing={isLoading}
          renderItem={({ item }) => <RecipeRow recipe={item} />}
        />
      )}
    </View>
  )
}

function RecipeRow({ recipe }: { recipe: Recipe }) {
  const router = useRouter()
  return (
    <Pressable
      style={s.row}
      onPress={() => router.push(`/recipes/${recipe.id}` as never)}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.rowName}>{recipe.name}</Text>
        <Text style={s.rowMeta}>
          {recipe.ingredients.length} ingredient
          {recipe.ingredients.length === 1 ? '' : 's'} · yields {fmt(recipe.yields_servings)}{' '}
          serving{recipe.yields_servings === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={s.rowStats}>
        <Text style={s.rowStatsCal}>
          {recipe.per_serving_macros.calories} kcal
        </Text>
        <Text style={s.rowStatsMacros}>
          P {fmt(recipe.per_serving_macros.protein_g)} · C{' '}
          {fmt(recipe.per_serving_macros.carbs_g)} · F{' '}
          {fmt(recipe.per_serving_macros.fat_g)}
        </Text>
      </View>
    </Pressable>
  )
}

function fmt(n: number): string {
  if (n === Math.floor(n)) return String(n)
  return n.toFixed(1)
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerBtn: { paddingHorizontal: spacing.base },
  headerBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  list: { padding: spacing.base, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.md,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.gray500, marginTop: 2 },
  rowStats: { alignItems: 'flex-end' },
  rowStatsCal: { fontSize: 15, fontWeight: '700', color: colors.primary },
  rowStatsMacros: {
    fontSize: 11,
    color: colors.gray500,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  emptyBody: {
    fontSize: 14,
    color: colors.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    marginTop: spacing.md,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
