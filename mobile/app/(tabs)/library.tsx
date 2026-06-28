import { useState, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import type { Equipment, Exercise, Muscle, MovementPattern } from '@fitness/shared-types'
import { exercisesApi } from '../../src/services/api'
import { colors, spacing, radius, card } from '../../src/theme'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MUSCLE_OPTIONS: Muscle[] = [
  'chest', 'back', 'quads', 'hamstrings', 'glutes',
  'shoulders', 'biceps', 'triceps', 'core', 'calves', 'forearms',
]

const PATTERN_OPTIONS: MovementPattern[] = ['push', 'pull', 'squat', 'hinge', 'carry', 'core']

const EQUIPMENT_OPTIONS: Equipment[] = [
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other',
]

const DIFFICULTY_OPTIONS = ['beginner', 'intermediate', 'advanced']

const MUSCLE_COLORS: Record<string, string> = {
  chest: '#ef4444',
  back: '#3b82f6',
  quads: '#f97316',
  hamstrings: '#f59e0b',
  glutes: '#ec4899',
  shoulders: '#8b5cf6',
  biceps: '#06b6d4',
  triceps: '#14b8a6',
  core: '#84cc16',
  calves: '#6366f1',
  forearms: '#6b7280',
}

const PAGE_SIZE = 60

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

function ExerciseThumbnail({ exercise }: { exercise: Exercise }) {
  const firstImage = exercise.images?.[0]
  const muscle = exercise.primary_muscles[0] ?? 'back'
  const color = MUSCLE_COLORS[muscle] ?? '#9ca3af'
  const initial = exercise.name[0]?.toUpperCase() ?? '?'

  if (firstImage) {
    return (
      <Image
        source={{ uri: firstImage }}
        style={styles.thumbnail}
        contentFit="cover"
        placeholder={{ blurhash: undefined }}
        // Show colored initial fallback when image fails
        onError={() => {}}
      />
    )
  }

  return (
    <View style={[styles.thumbnail, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{initial}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Exercise row
// ---------------------------------------------------------------------------

function ExerciseRow({ exercise, onPress }: { exercise: Exercise; onPress: () => void }) {
  return (
    <Pressable style={[card, styles.row]} onPress={onPress}>
      <ExerciseThumbnail exercise={exercise} />
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{exercise.name}</Text>
        <View style={styles.chipRow}>
          {exercise.primary_muscles.map((m) => (
            <View key={`p-${m}`} style={[styles.chip, { backgroundColor: MUSCLE_COLORS[m] ?? '#9ca3af' }]}>
              <Text style={styles.chipTextWhite}>{m}</Text>
            </View>
          ))}
          {exercise.secondary_muscles.slice(0, 2).map((m) => (
            <View
              key={`s-${m}`}
              style={[
                styles.chip,
                {
                  backgroundColor: (MUSCLE_COLORS[m] ?? '#9ca3af') + '33',
                  borderWidth: 1,
                  borderColor: (MUSCLE_COLORS[m] ?? '#9ca3af') + '55',
                },
              ]}
            >
              <Text style={[styles.chipTextColored, { color: MUSCLE_COLORS[m] ?? '#9ca3af' }]}>{m}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.rowEquip}>{exercise.equipment}</Text>
      </View>
      {exercise.difficulty != null && (
        <Text style={styles.diffLabel}>{exercise.difficulty}</Text>
      )}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  active,
  color,
  onPress,
}: {
  label: string
  active: boolean
  color?: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.filterChip,
        active
          ? { backgroundColor: color ?? colors.primary, borderColor: color ?? colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.gray200 },
      ]}
    >
      <Text style={[styles.filterChipText, { color: active ? '#fff' : colors.gray600 }]}>
        {label}
      </Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function LibraryScreen() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | ''>('')
  const [pattern, setPattern] = useState<MovementPattern | ''>('')
  const [equipment, setEquipment] = useState<Equipment | ''>('')
  const [difficulty, setDifficulty] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const { data: allExercises = [], isLoading } = useQuery({
    queryKey: ['exercises', q, muscle, pattern],
    queryFn: () =>
      exercisesApi.list({
        ...(q ? { q } : {}),
        ...(muscle ? { muscle } : {}),
        ...(pattern ? { pattern } : {}),
      }),
    staleTime: 5 * 60_000,
  })

  const filtered = allExercises.filter((ex) => {
    if (equipment && ex.equipment !== equipment) return false
    if (difficulty && ex.difficulty?.toLowerCase() !== difficulty) return false
    return true
  })

  const shown = filtered.slice(0, visible)
  const hasMore = visible < filtered.length

  const resetVisible = useCallback(() => setVisible(PAGE_SIZE), [])

  const handleMuscle = (m: Muscle | '') => { setMuscle(m); resetVisible() }
  const handlePattern = (p: MovementPattern | '') => { setPattern(p); resetVisible() }

  const hasFilters = !!(muscle || pattern || equipment || difficulty || q)

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          placeholder="Search exercises..."
          placeholderTextColor={colors.gray400}
          value={q}
          onChangeText={(v) => { setQ(v); resetVisible() }}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* Muscle chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
        style={styles.chipScrollWrap}
      >
        <FilterChip
          label="All muscles"
          active={muscle === ''}
          onPress={() => handleMuscle('')}
        />
        {MUSCLE_OPTIONS.map((m) => (
          <FilterChip
            key={m}
            label={m}
            active={muscle === m}
            color={MUSCLE_COLORS[m]}
            onPress={() => handleMuscle(muscle === m ? '' : m)}
          />
        ))}
      </ScrollView>

      {/* Pattern chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
        style={styles.chipScrollWrap}
      >
        <FilterChip
          label="All patterns"
          active={pattern === ''}
          onPress={() => handlePattern('')}
        />
        {PATTERN_OPTIONS.map((p) => (
          <FilterChip
            key={p}
            label={p}
            active={pattern === p}
            onPress={() => handlePattern(pattern === p ? '' : p)}
          />
        ))}
      </ScrollView>

      {/* Equipment + difficulty row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
        style={styles.chipScrollWrap}
      >
        <FilterChip
          label="Any equipment"
          active={equipment === ''}
          onPress={() => { setEquipment(''); resetVisible() }}
        />
        {EQUIPMENT_OPTIONS.map((e) => (
          <FilterChip
            key={e}
            label={e}
            active={equipment === e}
            onPress={() => { setEquipment(equipment === e ? '' : e as Equipment); resetVisible() }}
          />
        ))}
        <View style={styles.chipDivider} />
        <FilterChip
          label="Any difficulty"
          active={difficulty === ''}
          onPress={() => { setDifficulty(''); resetVisible() }}
        />
        {DIFFICULTY_OPTIONS.map((d) => (
          <FilterChip
            key={d}
            label={d}
            active={difficulty === d}
            onPress={() => { setDifficulty(difficulty === d ? '' : d); resetVisible() }}
          />
        ))}
        {hasFilters && (
          <Pressable
            onPress={() => {
              setMuscle('')
              setPattern('')
              setEquipment('')
              setDifficulty('')
              setQ('')
              resetVisible()
            }}
            style={styles.clearBtn}
          >
            <Text style={styles.clearBtnText}>Clear filters</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Count */}
      {!isLoading && (
        <Text style={styles.countText}>
          {filtered.length === 0
            ? 'No exercises found'
            : `${filtered.length} exercise${filtered.length === 1 ? '' : 's'}`}
        </Text>
      )}

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            No exercises match your filters. Try adjusting or clearing them.
          </Text>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ExerciseRow
              exercise={item}
              onPress={() => router.push(`/library/${item.id}`)}
            />
          )}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          ListFooterComponent={
            hasMore ? (
              <Pressable
                onPress={() => setVisible((v) => v + PAGE_SIZE)}
                style={styles.showMoreBtn}
              >
                <Text style={styles.showMoreText}>
                  Show more ({filtered.length - visible} remaining)
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchWrap: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 40,
    fontSize: 14,
    color: colors.text,
  },
  chipScrollWrap: {
    flexGrow: 0,
    flexShrink: 0,
    height: 44,
    marginBottom: spacing.xs,
  },
  chipScroll: {
    paddingHorizontal: spacing.base,
    gap: spacing.sm,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  chipDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.gray200,
    marginHorizontal: 4,
    alignSelf: 'center',
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: colors.surface,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.error,
  },
  countText: {
    fontSize: 12,
    color: colors.gray400,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: 14,
    color: colors.gray400,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingBottom: 100,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    flexShrink: 0,
    backgroundColor: colors.gray100,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  chipTextWhite: {
    fontSize: 11,
    fontWeight: '500',
    color: '#fff',
    textTransform: 'capitalize',
  },
  chipTextColored: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  rowEquip: {
    fontSize: 11,
    color: colors.gray400,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  diffLabel: {
    fontSize: 11,
    color: colors.gray400,
    flexShrink: 0,
    textTransform: 'capitalize',
  },
  showMoreBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  showMoreText: {
    fontSize: 14,
    color: colors.gray400,
    fontWeight: '500',
  },
})
