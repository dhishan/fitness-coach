/**
 * Saved foods — unified library of your saved foods (favorites) and recipes.
 * Tap a recipe to edit it in the recipe editor; tap a food to edit it inline.
 * "+ New" lets you create either. Logging happens from the Add Food search.
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter, Stack } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import type { Favorite, Recipe } from '@fitness/shared-types'
import { nutritionApi } from '../../src/services/api'
import FavoriteEditSheet from '../../src/components/FavoriteEditSheet'
import { colors, radius, spacing } from '../../src/theme'

type Row =
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'food'; food: Favorite }

export default function SavedFoodsList() {
  const router = useRouter()
  const [editFav, setEditFav] = useState<Favorite | null>(null)
  const [newFavOpen, setNewFavOpen] = useState(false)

  const { data: recipes = [], isLoading: lr, refetch: rr } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => nutritionApi.recipes.list(),
  })
  const { data: favorites = [], isLoading: lf, refetch: rf } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => nutritionApi.favorites.list(),
  })

  const isLoading = lr || lf
  const rows: Row[] = [
    ...favorites.map((f) => ({ kind: 'food' as const, food: f })),
    ...recipes.map((r) => ({ kind: 'recipe' as const, recipe: r })),
  ]

  const promptNew = () => {
    Alert.alert('New saved item', 'What would you like to create?', [
      { text: 'Food (single item)', onPress: () => setNewFavOpen(true) },
      { text: 'Recipe (from ingredients)', onPress: () => router.push('/recipes/new' as never) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  return (
    <View style={s.screen}>
      <Stack.Screen
        options={{
          title: 'Saved foods',
          headerRight: () => (
            <TouchableOpacity onPress={promptNew} style={s.headerBtn}>
              <Text style={s.headerBtnText}>+ New</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : rows.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No saved foods yet</Text>
          <Text style={s.emptyBody}>
            Save foods you eat often and recipes you make, then log them in one tap from Add Food.
          </Text>
          <TouchableOpacity style={s.emptyBtn} onPress={promptNew}>
            <Text style={s.emptyBtnText}>+ New saved food</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => (row.kind === 'recipe' ? `r-${row.recipe.id}` : `f-${row.food.id}`)}
          contentContainerStyle={s.list}
          onRefresh={() => { void rr(); void rf() }}
          refreshing={isLoading}
          renderItem={({ item }) =>
            item.kind === 'recipe' ? (
              <RecipeRow recipe={item.recipe} onPress={() => router.push(`/recipes/${item.recipe.id}` as never)} />
            ) : (
              <FoodRow food={item.food} onPress={() => setEditFav(item.food)} />
            )
          }
        />
      )}

      <FavoriteEditSheet
        visible={newFavOpen || !!editFav}
        favorite={editFav}
        onClose={() => { setEditFav(null); setNewFavOpen(false) }}
        onSaved={() => { setEditFav(null); setNewFavOpen(false) }}
      />
    </View>
  )
}

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{label}</Text>
    </View>
  )
}

function RecipeRow({ recipe, onPress }: { recipe: Recipe; onPress: () => void }) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <View style={s.nameRow}>
          <Text style={s.rowName} numberOfLines={1}>{recipe.name}</Text>
          <Badge label="Recipe" bg="#ecfdf5" fg="#16a34a" />
        </View>
        <Text style={s.rowMeta}>
          {recipe.ingredients.length} ingredient{recipe.ingredients.length === 1 ? '' : 's'} · yields {fmt(recipe.yields_servings)}
        </Text>
      </View>
      <Text style={s.rowKcal}>{recipe.per_serving_macros.calories} kcal</Text>
    </Pressable>
  )
}

function FoodRow({ food, onPress }: { food: Favorite; onPress: () => void }) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <View style={s.nameRow}>
          <Text style={s.rowName} numberOfLines={1}>{food.name}</Text>
          <Badge label="Food" bg="#fef2f2" fg="#dc2626" />
        </View>
        {food.serving ? <Text style={s.rowMeta}>{food.serving}</Text> : null}
      </View>
      <Text style={s.rowKcal}>{Math.round(food.macros.calories)} kcal</Text>
    </Pressable>
  )
}

function fmt(n: number): string {
  return n === Math.floor(n) ? String(n) : n.toFixed(1)
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.gray500, marginTop: 2 },
  rowKcal: { fontSize: 15, fontWeight: '700', color: colors.primary },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  emptyBody: { fontSize: 14, color: colors.gray500, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.full, marginTop: spacing.md },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
