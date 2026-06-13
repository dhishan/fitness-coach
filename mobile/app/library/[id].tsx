// Library detail screen - mirrors frontend/src/pages/LibraryDetail.tsx

import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
} from 'react-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Exercise, Workout, WorkoutListResponse } from '@fitness/shared-types'
import { exercisesApi, workoutsApi } from '../../src/services/api'
import { toLocalISODate } from '../../src/lib/dates'
import { buildEntryFromHistory } from '../../src/lib/addExercise'
import { formatLastTime } from '../../src/lib/workoutHelpers'
import { colors, spacing, radius, card } from '../../src/theme'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const DIFFICULTY_COLOR: Record<string, string> = {
  beginner: '#22c55e',
  intermediate: '#f59e0b',
  advanced: '#ef4444',
}

// ---------------------------------------------------------------------------
// Photo pair (tap to toggle start/end)
// ---------------------------------------------------------------------------

function PhotoPair({ images, name }: { images: string[]; name: string }) {
  const [idx, setIdx] = useState(0)
  if (images.length === 0) return null

  return (
    <Pressable
      onPress={() => setIdx((i) => (images.length > 1 ? (i + 1) % images.length : i))}
      style={styles.photoPair}
    >
      <Image
        source={{ uri: images[idx] }}
        style={styles.photoImg}
        contentFit="cover"
      />
      {images.length > 1 && (
        <View style={styles.photoOverlayRow}>
          <View style={styles.photoTapLabel}>
            <Text style={styles.photoTapText}>Tap to toggle</Text>
          </View>
          <View style={styles.photoDots}>
            {images.map((_, i) => (
              <View
                key={i}
                style={[styles.photoDot, { opacity: i === idx ? 1 : 0.5 }]}
              />
            ))}
          </View>
        </View>
      )}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Alternative card
// ---------------------------------------------------------------------------

function AlternativeCard({ exercise, onPress }: { exercise: Exercise; onPress: () => void }) {
  const firstImage = exercise.images?.[0]
  const muscle = exercise.primary_muscles[0] ?? 'back'
  const color = MUSCLE_COLORS[muscle] ?? '#9ca3af'
  const initial = exercise.name[0]?.toUpperCase() ?? '?'

  return (
    <Pressable style={[card, styles.altCard]} onPress={onPress}>
      <View style={styles.altThumbWrap}>
        {firstImage ? (
          <Image source={{ uri: firstImage }} style={styles.altThumb} contentFit="cover" />
        ) : (
          <View style={[styles.altThumb, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{initial}</Text>
          </View>
        )}
      </View>
      <Text style={styles.altName} numberOfLines={2}>{exercise.name}</Text>
      <Text style={styles.altEquip}>{exercise.equipment}</Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Main detail screen
// ---------------------------------------------------------------------------

export default function LibraryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)

  // Load exercises from cache (keyed same way as list screen)
  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ['exercises', '', '', ''],
    queryFn: () => exercisesApi.list(),
    staleTime: 5 * 60_000,
  })

  const exercise = exercises.find((e) => e.id === id)

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['exercise-history', id],
    queryFn: () => exercisesApi.history(id!, 3),
    enabled: !!id,
    staleTime: 60_000,
  })

  const { data: alternatives = [], isLoading: altsLoading } = useQuery({
    queryKey: ['alternatives', id],
    queryFn: () => exercisesApi.alternatives(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })

  const { data: activeWorkout } = useQuery({
    queryKey: ['workout', 'active'],
    queryFn: () => workoutsApi.active(),
    staleTime: 0,
  })

  const handleAddToWorkout = async () => {
    if (!exercise) return
    setAdding(true)
    try {
      let workoutId: string

      if (activeWorkout) {
        workoutId = activeWorkout.id
      } else {
        const created = await workoutsApi.create({ date: toLocalISODate() })
        workoutId = created.id
        void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      }

      let hist = history
      if (hist.length === 0) {
        try {
          hist = await exercisesApi.history(exercise.id, 1)
        } catch {
          hist = []
        }
      }

      const entry = buildEntryFromHistory(exercise, hist)
      const currentWorkout = await workoutsApi.get(workoutId)
      const newEntries = [...currentWorkout.entries, { ...entry }]
      await workoutsApi.update(workoutId, { entries: newEntries })
      void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      router.push('/(tabs)/workout')
    } catch {
      Alert.alert('Error', 'Could not add exercise. Please try again.')
    } finally {
      setAdding(false)
    }
  }

  if (!exercise) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.notFoundText}>Loading exercise...</Text>
      </View>
    )
  }

  const difficultyColor = exercise.difficulty
    ? (DIFFICULTY_COLOR[exercise.difficulty.toLowerCase()] ?? '#9ca3af')
    : null

  const ctaLabel = activeWorkout ? 'Add to current workout' : 'Start workout with this'

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Photos */}
        {exercise.images && exercise.images.length > 0 && (
          <PhotoPair images={exercise.images} name={exercise.name} />
        )}

        {/* Name + difficulty */}
        <View style={styles.nameRow}>
          <Text style={styles.name}>{exercise.name}</Text>
          {exercise.difficulty != null && difficultyColor != null && (
            <View style={[styles.diffPill, { backgroundColor: difficultyColor }]}>
              <Text style={styles.diffPillText}>{exercise.difficulty}</Text>
            </View>
          )}
        </View>

        {/* Muscles */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MUSCLES</Text>
          <View style={styles.muscleChips}>
            {exercise.primary_muscles.map((m) => (
              <View key={`p-${m}`} style={[styles.muscleChip, { backgroundColor: MUSCLE_COLORS[m] ?? '#9ca3af' }]}>
                <Text style={styles.muscleChipTextWhite}>{m}</Text>
              </View>
            ))}
            {exercise.secondary_muscles.map((m) => (
              <View
                key={`s-${m}`}
                style={[
                  styles.muscleChip,
                  {
                    backgroundColor: (MUSCLE_COLORS[m] ?? '#9ca3af') + '33',
                    borderWidth: 1,
                    borderColor: (MUSCLE_COLORS[m] ?? '#9ca3af') + '55',
                  },
                ]}
              >
                <Text style={[styles.muscleChipTextColored, { color: MUSCLE_COLORS[m] ?? '#9ca3af' }]}>{m}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Equipment + pattern */}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.sectionLabel}>EQUIPMENT</Text>
            <Text style={styles.metaValue}>{exercise.equipment}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.sectionLabel}>PATTERN</Text>
            <Text style={styles.metaValue}>{exercise.movement_pattern}</Text>
          </View>
        </View>

        {/* Instructions */}
        {exercise.instructions && exercise.instructions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>INSTRUCTIONS</Text>
            {exercise.instructions.map((step, i) => (
              <View key={i} style={styles.instructionRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.instructionText}>{step}</Text>
              </View>
            ))}
          </View>
        )}

        {/* History */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>YOUR HISTORY</Text>
          {histLoading ? (
            <Text style={styles.loadingText}>Loading...</Text>
          ) : history.length === 0 ? (
            <Text style={styles.emptyText}>
              No history yet. Log a session with this exercise to see it here.
            </Text>
          ) : (
            history.map((item) => (
              <View key={item.workout_id} style={[card, styles.histCard]}>
                <Text style={styles.histDate}>{item.date}</Text>
                <Text style={styles.histSets}>{formatLastTime(item.sets, item.date)}</Text>
              </View>
            ))
          )}
        </View>

        {/* Alternatives */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ALTERNATIVES</Text>
          {altsLoading ? (
            <Text style={styles.loadingText}>Loading...</Text>
          ) : alternatives.length === 0 ? (
            <Text style={styles.emptyText}>No alternatives found.</Text>
          ) : (
            <FlatList
              horizontal
              data={alternatives}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <AlternativeCard
                  exercise={item}
                  onPress={() => router.push(`/library/${item.id}`)}
                />
              )}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.altList}
              scrollEnabled
            />
          )}
        </View>

        {/* Bottom padding for sticky CTA */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.cta}>
        <Pressable
          onPress={() => void handleAddToWorkout()}
          disabled={adding}
          style={[styles.ctaBtn, adding && { opacity: 0.5 }]}
        >
          <Text style={styles.ctaBtnText}>
            {adding ? 'Adding...' : ctaLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  notFoundText: {
    fontSize: 14,
    color: colors.gray400,
  },
  scrollContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
  },
  photoPair: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.base,
  },
  photoImg: {
    width: '100%',
    height: '100%',
  },
  photoOverlayRow: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photoTapLabel: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  photoTapText: {
    color: '#fff',
    fontSize: 11,
  },
  photoDots: {
    flexDirection: 'row',
    gap: 4,
  },
  photoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  name: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  diffPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    flexShrink: 0,
  },
  diffPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gray500,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  muscleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  muscleChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  muscleChipTextWhite: {
    fontSize: 12,
    fontWeight: '500',
    color: '#fff',
    textTransform: 'capitalize',
  },
  muscleChipTextColored: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginBottom: spacing.lg,
  },
  metaItem: {
    gap: 4,
  },
  metaValue: {
    fontSize: 14,
    color: colors.gray700,
    textTransform: 'capitalize',
  },
  instructionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: colors.gray700,
    lineHeight: 20,
  },
  histCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  histDate: {
    fontSize: 11,
    color: colors.gray400,
    marginBottom: 2,
  },
  histSets: {
    fontSize: 14,
    color: colors.gray700,
  },
  loadingText: {
    fontSize: 14,
    color: colors.gray400,
  },
  emptyText: {
    fontSize: 14,
    color: colors.gray400,
  },
  altList: {
    gap: spacing.md,
    paddingBottom: 4,
  },
  altCard: {
    width: 144,
    padding: spacing.md,
    flexShrink: 0,
  },
  altThumbWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.gray100,
    marginBottom: spacing.sm,
  },
  altThumb: {
    width: '100%',
    height: '100%',
  },
  altName: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
    lineHeight: 16,
  },
  altEquip: {
    fontSize: 11,
    color: colors.gray400,
    textTransform: 'capitalize',
    marginTop: 2,
  },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.base,
    paddingBottom: spacing.lg,
  },
  ctaBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
})
