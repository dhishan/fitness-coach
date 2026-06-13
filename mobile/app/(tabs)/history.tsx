// History tab screen - mirrors frontend/src/pages/History.tsx

import { useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Workout } from '@fitness/shared-types'
import { workoutsApi } from '../../src/services/api'
import { toLocalISODate } from '../../src/lib/dates'
import { colors, spacing, radius, card, shadow } from '../../src/theme'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatVolume(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k kg'
  return v + ' kg'
}

function exerciseNamesLine(w: Workout): string {
  const names = w.entries.map((e) => e.exercise_name)
  if (names.length === 0) return 'No exercises'
  if (names.length <= 3) return names.join(', ')
  return names.slice(0, 3).join(', ') + ' +' + (names.length - 3) + ' more'
}

function ym(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Calendar view
// ---------------------------------------------------------------------------

function CalendarView({
  year,
  month,
  onPrev,
  onNext,
}: {
  year: number
  month: number
  onPrev: () => void
  onNext: () => void
}) {
  const router = useRouter()
  const todayStr = toLocalISODate()
  const [todayYear, todayMonthNum] = todayStr.split('-').map(Number)
  const isFutureMonth = year > todayYear || (year === todayYear && month > todayMonthNum - 1)

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const fromStr = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0)
  const toStr = toLocalISODate(lastDay)

  const ymKey = ym(year, month)
  const { data: monthData } = useQuery({
    queryKey: ['workouts-month', ymKey],
    queryFn: () => workoutsApi.list({ from: fromStr, to: toStr, limit: 100 }),
    staleTime: 5 * 60_000,
  })

  const workoutsByDate = new Map<string, Workout[]>()
  for (const w of (monthData?.items ?? [])) {
    const existing = workoutsByDate.get(w.date) ?? []
    existing.push(w)
    workoutsByDate.set(w.date, existing)
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <View style={[card, styles.calCard]}>
      {/* Header row */}
      <View style={styles.calHeader}>
        <Pressable onPress={onPrev} style={styles.calNavBtn}>
          <Text style={styles.calNavText}>{'<'}</Text>
        </Pressable>
        <Text style={styles.calMonthLabel}>{monthLabel}</Text>
        <Pressable
          onPress={onNext}
          disabled={isFutureMonth}
          style={[styles.calNavBtn, isFutureMonth && { opacity: 0.3 }]}
        >
          <Text style={styles.calNavText}>{'>'}</Text>
        </Pressable>
      </View>

      {/* Day labels */}
      <View style={styles.calGrid}>
        {dayLabels.map((d) => (
          <Text key={d} style={styles.calDayLabel}>{d}</Text>
        ))}
      </View>

      {/* Date cells */}
      <View style={styles.calGrid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.calCell} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const workouts = workoutsByDate.get(dateStr) ?? []
          const hasWorkout = workouts.length > 0
          const isToday = dateStr === todayStr

          return (
            <Pressable
              key={i}
              onPress={() => {
                if (workouts.length === 1) router.push(`/history/${workouts[0].id}`)
              }}
              disabled={workouts.length === 0}
              style={[
                styles.calCell,
                hasWorkout && { backgroundColor: colors.primary },
                isToday && !hasWorkout && {
                  borderWidth: 1,
                  borderColor: colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.calDayNum,
                  hasWorkout ? { color: '#fff', fontWeight: '600' } : isToday ? { color: colors.primary } : {},
                ]}
              >
                {day}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Workout row
// ---------------------------------------------------------------------------

function WorkoutRow({ workout }: { workout: Workout }) {
  const router = useRouter()
  return (
    <Pressable
      style={[card, styles.workoutRow]}
      onPress={() => router.push(`/history/${workout.id}`)}
    >
      <View style={styles.workoutRowMain}>
        <Text style={styles.workoutDate}>{formatDate(workout.date)}</Text>
        <Text style={styles.workoutExercises} numberOfLines={1}>
          {exerciseNamesLine(workout)}
        </Text>
      </View>
      <Text style={styles.workoutVolume}>{formatVolume(workout.total_volume)}</Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function HistoryScreen() {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const today = toLocalISODate()
  const [todayYear, todayMonthNum] = today.split('-').map(Number)
  const [calYear, setCalYear] = useState(todayYear)
  const [calMonth, setCalMonth] = useState(todayMonthNum - 1) // 0-indexed

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['workouts'],
    queryFn: ({ pageParam = 0 }) =>
      workoutsApi.list({ limit: 20, offset: pageParam as number }),
    getNextPageParam: (lastPage, allPages) => {
      const accumulated = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (accumulated < lastPage.total) return accumulated
      return undefined
    },
    initialPageParam: 0,
    staleTime: 5 * 60_000,
  })

  const total = data?.pages[0]?.total ?? 0
  const allWorkouts = data?.pages.flatMap((p) => p.items) ?? []

  const prevMonth = useCallback(() => {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11) }
    else setCalMonth((m) => m - 1)
  }, [calMonth])

  const nextMonth = useCallback(() => {
    const [cy, cm] = today.split('-').map(Number)
    const nextY = calMonth === 11 ? calYear + 1 : calYear
    const nextM = calMonth === 11 ? 0 : calMonth + 1
    if (nextY > cy || (nextY === cy && nextM > cm - 1)) return
    setCalYear(nextY)
    setCalMonth(nextM)
  }, [calMonth, calYear, today])

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {status === 'success'
            ? `${total} workout${total === 1 ? '' : 's'}`
            : 'History'}
        </Text>
        <View style={styles.toggleWrap}>
          <Pressable
            onPress={() => setView('list')}
            style={[styles.toggleBtn, view === 'list' && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, view === 'list' && styles.toggleTextActive]}>
              List
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setView('calendar')}
            style={[styles.toggleBtn, view === 'calendar' && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, view === 'calendar' && styles.toggleTextActive]}>
              Calendar
            </Text>
          </Pressable>
        </View>
      </View>

      {view === 'calendar' ? (
        <FlatList
          data={[]}
          renderItem={null}
          ListHeaderComponent={
            <CalendarView
              year={calYear}
              month={calMonth}
              onPrev={prevMonth}
              onNext={nextMonth}
            />
          }
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={allWorkouts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <WorkoutRow workout={item} />}
          contentContainerStyle={styles.listContent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            status === 'pending' ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            status === 'success' ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  No workouts yet. Start your first session.
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoading}>
                <Text style={styles.footerText}>Loading more...</Text>
              </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.gray100,
    borderRadius: radius.sm,
    padding: 2,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: colors.surface,
    ...shadow,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray500,
  },
  toggleTextActive: {
    color: colors.text,
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingBottom: 100,
  },
  workoutRow: {
    padding: spacing.base,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workoutRowMain: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  workoutDate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  workoutExercises: {
    fontSize: 12,
    color: colors.gray500,
    marginTop: 2,
  },
  workoutVolume: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.gray700,
    flexShrink: 0,
  },
  loadingWrap: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing.xl * 2,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: 14,
    color: colors.gray500,
    textAlign: 'center',
  },
  footerLoading: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: colors.gray400,
  },
  // Calendar styles
  calCard: {
    padding: spacing.base,
    marginBottom: spacing.base,
    marginTop: spacing.sm,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  calNavBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  calNavText: {
    fontSize: 16,
    color: colors.gray500,
    fontWeight: '600',
  },
  calMonthLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calDayLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    color: colors.gray400,
    fontWeight: '500',
    paddingBottom: 4,
  },
  calCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  calDayNum: {
    fontSize: 12,
    color: colors.gray400,
  },
})
