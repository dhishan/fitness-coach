// History detail screen - mirrors frontend/src/pages/HistoryDetail.tsx

import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import type { Workout, WorkoutListResponse } from '@fitness/shared-types'
import { workoutsApi } from '../../src/services/api'
import { colors, spacing, radius, card } from '../../src/theme'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatVolume(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k kg'
  return v + ' kg'
}

// ---------------------------------------------------------------------------
// Entry card (read-only)
// ---------------------------------------------------------------------------

type EntryLike = Workout['entries'][number]

function EntryCard({ entry }: { entry: EntryLike }) {
  const workingSets = entry.sets.filter((s) => !s.is_warmup)
  const warmupSets = entry.sets.filter((s) => s.is_warmup)

  return (
    <View style={styles.entryCard}>
      <Text style={styles.entryName}>{entry.exercise_name}</Text>
      {warmupSets.map((s, i) => (
        <View key={`w${i}`} style={styles.setRow}>
          <Text style={styles.setLabelWarmup}>Warmup {i + 1}</Text>
          <Text style={styles.setValueWarmup}>
            {s.weight} kg x {s.reps}
            {s.rpe != null ? `  RPE ${s.rpe}` : ''}
          </Text>
        </View>
      ))}
      {workingSets.map((s, i) => (
        <View key={`s${i}`} style={styles.setRow}>
          <Text style={styles.setLabel}>Set {i + 1}</Text>
          <Text style={styles.setValue}>
            {s.weight} kg x {s.reps}
            {s.rpe != null ? `  RPE ${s.rpe}` : ''}
          </Text>
        </View>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: workout, status } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => workoutsApi.get(id!),
    enabled: !!id,
  })

  const handleDelete = () => {
    if (!id) return
    Alert.alert(
      'Delete workout',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await workoutsApi.remove(id)

              // Surgical cache update: remove from infinite list, decrement total per page
              queryClient.setQueryData(
                ['workouts'],
                (old: { pages: { items: Workout[]; total: number }[]; pageParams: number[] } | undefined) => {
                  if (!old) return old
                  return {
                    ...old,
                    pages: old.pages.map((p) => ({
                      ...p,
                      items: p.items.filter((w) => w.id !== id),
                      total: Math.max(0, p.total - 1),
                    })),
                  }
                },
              )

              router.back()
            } catch {
              Alert.alert('Error', 'Failed to delete workout. Please try again.')
            }
          },
        },
      ],
    )
  }

  if (status === 'pending') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  if (status === 'error' || !workout) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundText}>Workout not found.</Text>
      </View>
    )
  }

  // Group entries by superset_group (same logic as web)
  const groups: { supersetGroup: string | null; entries: typeof workout.entries }[] = []
  const seen = new Set<string>()
  for (const entry of workout.entries) {
    const sg = entry.superset_group ?? null
    if (sg && seen.has(sg)) continue
    if (sg) seen.add(sg)
    const groupEntries = sg
      ? workout.entries.filter((e) => e.superset_group === sg)
      : [entry]
    groups.push({ supersetGroup: sg, entries: groupEntries })
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header card */}
      <View style={[card, styles.headerCard]}>
        <Text style={styles.headerDate}>{formatDate(workout.date)}</Text>
        <View style={styles.headerMeta}>
          <Text style={styles.headerMetaText}>
            {workout.entries.length} exercise{workout.entries.length === 1 ? '' : 's'}
          </Text>
          <Text style={styles.headerMetaDot}> · </Text>
          <Text style={styles.headerMetaText}>{formatVolume(workout.total_volume)} total volume</Text>
        </View>
        {workout.notes ? (
          <Text style={styles.notes}>{workout.notes}</Text>
        ) : null}
      </View>

      {/* Entries */}
      {groups.length === 0 && (
        <Text style={styles.noExercises}>No exercises recorded.</Text>
      )}

      {groups.map(({ supersetGroup, entries }, gi) => {
        if (supersetGroup) {
          return (
            <View key={supersetGroup} style={[card, styles.supersetBlock]}>
              <View style={styles.supersetLabel}>
                <Text style={styles.supersetLabelText}>SUPERSET</Text>
              </View>
              {entries.map((entry) => (
                <EntryCard key={entry.exercise_id + supersetGroup} entry={entry} />
              ))}
            </View>
          )
        }
        return (
          <View key={gi} style={[card, styles.entryBlock]}>
            <EntryCard entry={entries[0]} />
          </View>
        )
      })}

      {/* Delete button */}
      <Pressable onPress={handleDelete} style={styles.deleteBtn}>
        <Text style={styles.deleteBtnText}>Delete Workout</Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.base,
    paddingBottom: 60,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    fontSize: 14,
    color: colors.gray400,
  },
  headerCard: {
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  headerDate: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  headerMetaText: {
    fontSize: 13,
    color: colors.gray500,
  },
  headerMetaDot: {
    fontSize: 13,
    color: colors.gray400,
  },
  notes: {
    fontSize: 13,
    color: colors.gray600,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.gray100,
  },
  noExercises: {
    fontSize: 14,
    color: colors.gray400,
    textAlign: 'center',
    paddingVertical: spacing.base,
  },
  entryBlock: {
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  supersetBlock: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  supersetLabel: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    paddingBottom: 4,
  },
  supersetLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  entryCard: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  entryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: 4,
  },
  setLabel: {
    width: 50,
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray700,
  },
  setValue: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray700,
  },
  setLabelWarmup: {
    width: 65,
    fontSize: 12,
    color: colors.gray400,
  },
  setValueWarmup: {
    fontSize: 12,
    color: colors.gray400,
  },
  deleteBtn: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fca5a5',
    alignItems: 'center',
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.error,
  },
})
