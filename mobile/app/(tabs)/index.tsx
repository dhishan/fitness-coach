import React, { useEffect, useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LineChart } from 'react-native-chart-kit'
import type { BodyMetric, CardioLog, DashboardSummary, Exercise, ProgressPoint, Workout, WorkoutTemplate } from '@fitness/shared-types'
import { bodyApi, cardioApi, dashboardApi, exercisesApi, templatesApi, workoutsApi } from '../../src/services/api'
import * as HealthKit from '../../src/services/healthkit'
import { colors, spacing, radius, card, shadow } from '../../src/theme'
import { toLocalISODate } from '../../src/lib/dates'
import { startFromPlan } from '../../src/lib/startFromPlan'

const SCREEN_WIDTH = Dimensions.get('window').width

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function activeDuration(workout: Workout): string {
  if (!workout.started_at) return ''
  const start = new Date(workout.started_at)
  const now = new Date()
  const mins = Math.floor((now.getTime() - start.getTime()) / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// ---------------------------------------------------------------------------
// WeekStrip
// ---------------------------------------------------------------------------

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function WeekStrip({ summary }: { summary: DashboardSummary }) {
  const weekStart = new Date(summary.week_start + 'T00:00:00')
  const trainedSet = new Set(summary.trained_dates)

  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const iso = toLocalISODate(d)
    return { label: DAY_LABELS[i], iso, trained: trainedSet.has(iso) }
  })

  const volumeLabel =
    summary.week_volume >= 1000
      ? `${(summary.week_volume / 1000).toFixed(1)}k kg`
      : `${summary.week_volume} kg`

  return (
    <View style={[card, s.cardPad]}>
      <View style={s.row}>
        <Text style={s.sectionTitle}>This week</Text>
        <View style={s.row}>
          {summary.streak_weeks > 0 && (
            <View style={s.streakBadge}>
              <Text style={s.streakText}>{summary.streak_weeks}w streak</Text>
            </View>
          )}
          <Text style={s.meta}>{volumeLabel} total</Text>
        </View>
      </View>
      <View style={s.dotsRow}>
        {dots.map((dot, i) => (
          <View key={i} style={s.dotItem}>
            <View style={[s.dot, dot.trained ? s.dotTrained : s.dotEmpty]} />
            <Text style={s.dotLabel}>{dot.label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.weekSummary}>
        {summary.sessions_this_week === 0
          ? 'No sessions yet this week'
          : `${summary.sessions_this_week} session${summary.sessions_this_week === 1 ? '' : 's'} this week`}
      </Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// ProgressChart
// ---------------------------------------------------------------------------

function ProgressChart() {
  const [selectedId, setSelectedId] = useState<string>('')
  const [showPicker, setShowPicker] = useState(false)

  const { data: exercises = [], isLoading: loadingEx } = useQuery<Exercise[]>({
    queryKey: ['exercises'],
    queryFn: () => exercisesApi.list(),
  })

  const currentId = selectedId || (exercises.length > 0 ? exercises[0].id : '')
  const currentName = exercises.find((e) => e.id === currentId)?.name ?? ''

  const { data: progress, isLoading: loadingProgress } = useQuery<ProgressPoint[]>({
    queryKey: ['exercise-progress', currentId],
    queryFn: () => dashboardApi.exerciseProgress(currentId),
    enabled: !!currentId,
  })

  const hasData = progress && progress.length > 0
  const chartWidth = SCREEN_WIDTH - spacing.base * 4

  return (
    <View style={[card, s.cardPad]}>
      <Text style={s.sectionTitle}>Progress</Text>

      {loadingEx ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      ) : exercises.length === 0 ? (
        <Text style={s.empty}>No exercises yet. Start your first session.</Text>
      ) : (
        <>
          <Pressable style={s.pickerTrigger} onPress={() => setShowPicker(true)}>
            <Text style={s.pickerTriggerText}>{currentName || 'Select exercise'}</Text>
            <Text style={s.pickerChevron}>v</Text>
          </Pressable>

          <Modal visible={showPicker} transparent animationType="fade">
            <Pressable style={s.pickerOverlay} onPress={() => setShowPicker(false)} />
            <View style={s.pickerModal}>
              <Text style={s.pickerModalTitle}>Select exercise</Text>
              <ScrollView style={{ maxHeight: 300 }}>
                {exercises.map((ex) => (
                  <Pressable
                    key={ex.id}
                    style={[s.pickerOption, ex.id === currentId && s.pickerOptionActive]}
                    onPress={() => {
                      setSelectedId(ex.id)
                      setShowPicker(false)
                    }}
                  >
                    <Text
                      style={[s.pickerOptionText, ex.id === currentId && s.pickerOptionTextActive]}
                    >
                      {ex.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Modal>

          {loadingProgress && (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
          )}

          {!loadingProgress && !hasData && (
            <Text style={s.empty}>Not enough data yet. Log a few sessions.</Text>
          )}

          {!loadingProgress && hasData && (
            <LineChart
              data={{
                labels: progress.map((p) => p.date.slice(5)),
                datasets: [
                  {
                    data: progress.map((p) => p.top_weight),
                    color: () => colors.primary,
                    strokeWidth: 2,
                  },
                  {
                    data: progress.map((p) => p.volume),
                    color: () => colors.hamstrings,
                    strokeWidth: 2,
                  },
                ],
                legend: ['Top weight (kg)', 'Volume (kg)'],
              }}
              width={chartWidth}
              height={180}
              chartConfig={{
                backgroundGradientFrom: colors.surface,
                backgroundGradientTo: colors.surface,
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
                labelColor: () => colors.gray500,
                propsForDots: { r: '3' },
              }}
              bezier
              style={{ marginTop: spacing.md, borderRadius: radius.md }}
            />
          )}
        </>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// MuscleSplit
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

function MuscleSplit({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)

  return (
    <View style={[card, s.cardPad]}>
      <Text style={s.sectionTitle}>
        {entries.length === 0 ? 'Muscle split' : 'Muscle split (last 4 weeks)'}
      </Text>
      {entries.length === 0 ? (
        <Text style={s.empty}>No data yet. Log a few sessions to see your muscle split.</Text>
      ) : (
        <View style={{ gap: 8, marginTop: spacing.sm }}>
          {entries.map(([muscle, vol]) => {
            const pct = total > 0 ? Math.round((vol / total) * 100) : 0
            const barColor = MUSCLE_COLORS[muscle] ?? '#9ca3af'
            return (
              <View key={muscle} style={s.muscleRow}>
                <Text style={s.muscleName}>{muscle}</Text>
                <View style={s.muscleBarBg}>
                  <View
                    style={[
                      s.muscleBarFill,
                      { width: `${pct}%` as unknown as number, backgroundColor: barColor },
                    ]}
                  />
                </View>
                <Text style={s.musclePct}>{pct}%</Text>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// PlansSection
// ---------------------------------------------------------------------------

function PlansSection({
  templates,
  onStart,
}: {
  templates: WorkoutTemplate[]
  onStart: (t: WorkoutTemplate) => void
}) {
  const router = useRouter()

  return (
    <View style={[card, s.cardPad]}>
      <View style={s.row}>
        <Text style={s.sectionTitle}>Your plans</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => router.push('/(tabs)/library')}>
            <Text style={s.newPlanBtn}>Browse exercises</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/plans/new')}>
            <Text style={s.newPlanBtn}>+ New plan</Text>
          </Pressable>
        </View>
      </View>
      {templates.length === 0 ? (
        <Text style={s.empty}>No plans yet. Create one to start sessions faster.</Text>
      ) : (
        <View style={{ gap: 8, marginTop: spacing.sm }}>
          {templates.map((t) => (
            <View key={t.id} style={s.planRow}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/plans/${t.id}`)}>
                <Text style={s.planName}>{t.name}</Text>
                <Text style={s.planMeta}>
                  {t.entries.length} exercise{t.entries.length === 1 ? '' : 's'}
                </Text>
              </Pressable>
              <Pressable style={s.startBtn} onPress={() => onStart(t)}>
                <Text style={s.startBtnText}>Start</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// AppleHealthCard
// ---------------------------------------------------------------------------

type HealthSyncState = 'idle' | 'syncing' | 'error'

function AppleHealthCard() {
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<HealthSyncState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    HealthKit.getLastSyncedAt().then((v) => { if (!cancelled) setLastSynced(v) })
    return () => { cancelled = true }
  }, [])

  const formatSynced = (iso: string | null): string => {
    if (!iso) return 'Never synced'
    const d = new Date(iso)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const handleConnect = async () => {
    setSyncState('syncing')
    setErrorMsg('')
    const ok = await HealthKit.init()
    if (!ok) {
      setSyncState('error')
      setErrorMsg('Health access denied. Grant it in iOS Settings > Health > Data Access.')
      return
    }
    // 30-day backfill
    const since = new Date()
    since.setDate(since.getDate() - 30)
    try {
      await HealthKit.syncToBackend(since)
      const ts = await HealthKit.getLastSyncedAt()
      setLastSynced(ts)
      setSyncState('idle')
    } catch {
      setSyncState('error')
      setErrorMsg('Sync failed. Check your connection and try again.')
    }
  }

  const handleSyncNow = async () => {
    setSyncState('syncing')
    setErrorMsg('')
    const lastIso = await HealthKit.getLastSyncedAt()
    const since = lastIso ? new Date(lastIso) : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d })()
    try {
      await HealthKit.syncToBackend(since)
      const ts = await HealthKit.getLastSyncedAt()
      setLastSynced(ts)
      setSyncState('idle')
    } catch {
      setSyncState('error')
      setErrorMsg('Sync failed. Check your connection and try again.')
    }
  }

  const handleDisconnect = async () => {
    Alert.alert(
      'Disconnect Apple Health',
      'This clears the sync record. Health permissions remain in iOS Settings > Health.',
      [
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await HealthKit.clearLastSyncedAt()
            setLastSynced(null)
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  const available = HealthKit.isAvailable()

  return (
    <View style={[card, s.cardPad]}>
      <Text style={s.sectionTitle}>Apple Health</Text>

      {!available ? (
        <Text style={[s.empty, { marginTop: spacing.sm }]}>
          Apple Health connects on iPhone with the dev build. Steps, weight, workouts, HRV, and sleep flow in here.
        </Text>
      ) : (
        <>
          <Text style={[s.meta, { marginTop: spacing.sm }]}>
            Last synced: {formatSynced(lastSynced)}
          </Text>

          {syncState === 'error' && (
            <Text style={[s.meta, { color: colors.error, marginTop: spacing.xs }]}>{errorMsg}</Text>
          )}

          <View style={[s.row, { marginTop: spacing.sm, gap: spacing.sm }]}>
            {!lastSynced ? (
              <Pressable
                style={[s.healthBtn, syncState === 'syncing' && s.btnDisabled]}
                onPress={() => { void handleConnect() }}
                disabled={syncState === 'syncing'}
              >
                <Text style={s.healthBtnText}>{syncState === 'syncing' ? 'Connecting...' : 'Connect'}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={[s.healthBtn, syncState === 'syncing' && s.btnDisabled, { flex: 1 }]}
                  onPress={() => { void handleSyncNow() }}
                  disabled={syncState === 'syncing'}
                >
                  <Text style={s.healthBtnText}>{syncState === 'syncing' ? 'Syncing...' : 'Sync now'}</Text>
                </Pressable>
                <Pressable style={s.healthBtnSecondary} onPress={() => { void handleDisconnect() }}>
                  <Text style={s.healthBtnSecondaryText}>Disconnect</Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// CardioCard
// ---------------------------------------------------------------------------

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function CardioCard() {
  const router = useRouter()

  const sevenDaysAgo = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return toLocalISODate(d)
  })()

  const { data: logs = [], isLoading } = useQuery<CardioLog[]>({
    queryKey: ['cardio', { from: sevenDaysAgo }],
    queryFn: () => cardioApi.list({ from: sevenDaysAgo, limit: 100 }),
  })

  const totalMin = Math.round(logs.reduce((sum, l) => sum + l.duration_s, 0) / 60)
  const totalKm = (logs.reduce((sum, l) => sum + (l.distance_m ?? 0), 0) / 1000)

  return (
    <View style={[card, s.cardPad]}>
      <View style={s.row}>
        <Text style={s.sectionTitle}>Cardio</Text>
        <Pressable onPress={() => router.push('/cardio')}>
          <Text style={s.bodyHistoryLink}>View all</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      ) : logs.length === 0 ? (
        <Text style={s.empty}>No cardio logged yet. Log a session to start tracking.</Text>
      ) : (
        <View style={[s.row, { marginTop: spacing.sm, gap: spacing.md }]}>
          <View style={s.cardioStat}>
            <Text style={s.cardioStatVal}>{logs.length}</Text>
            <Text style={s.cardioStatLabel}>sessions</Text>
          </View>
          <View style={s.cardioStat}>
            <Text style={s.cardioStatVal}>{totalMin}m</Text>
            <Text style={s.cardioStatLabel}>total time</Text>
          </View>
          {totalKm > 0 && (
            <View style={s.cardioStat}>
              <Text style={s.cardioStatVal}>{totalKm.toFixed(1)} km</Text>
              <Text style={s.cardioStatLabel}>distance</Text>
            </View>
          )}
        </View>
      )}

      <Text style={[s.meta, { marginTop: spacing.xs }]}>Last 7 days</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// BodyCard
// ---------------------------------------------------------------------------

function BodyCard() {
  const router = useRouter()
  const qc = useQueryClient()
  const today = toLocalISODate()
  const [weightInput, setWeightInput] = useState('')
  const [logging, setLogging] = useState(false)

  const { data: latest, isLoading } = useQuery<BodyMetric | null>({
    queryKey: ['body-latest'],
    queryFn: () => bodyApi.latest(),
  })

  const { data: history } = useQuery<BodyMetric[]>({
    queryKey: ['body', { limit: 90 }],
    queryFn: () => bodyApi.list({ limit: 90 }),
  })

  // 7d delta
  let delta: number | null = null
  if (latest && history && history.length >= 2) {
    const cutoff = new Date(latest.date + 'T00:00:00')
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffStr = toLocalISODate(cutoff)
    const ref = history.find((m) => m.date <= cutoffStr)
    if (ref) delta = latest.weight_kg - ref.weight_kg
  }

  const handleLog = async () => {
    const val = parseFloat(weightInput)
    if (!weightInput.trim() || isNaN(val) || val <= 0) {
      Alert.alert('Invalid weight', 'Enter a positive number (e.g. 75.5)')
      return
    }
    setLogging(true)
    try {
      await bodyApi.create({ date: today, weight_kg: val })
      setWeightInput('')
      void qc.invalidateQueries({ queryKey: ['body-latest'] })
      void qc.invalidateQueries({ queryKey: ['body'] })
    } catch {
      Alert.alert('Error', 'Could not save weight')
    } finally {
      setLogging(false)
    }
  }

  return (
    <View style={[card, s.cardPad]}>
      <View style={s.row}>
        <Text style={s.sectionTitle}>Body</Text>
        <Pressable onPress={() => router.push('/body')}>
          <Text style={s.bodyHistoryLink}>View history</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      ) : latest ? (
        <View style={[s.row, { marginTop: spacing.sm }]}>
          <View>
            <Text style={s.bodyWeight}>{latest.weight_kg} kg</Text>
            <Text style={s.bodyDate}>{latest.date}</Text>
          </View>
          {delta !== null && (
            <Text style={[s.bodyDelta, delta > 0 ? s.bodyDeltaUp : s.bodyDeltaDown]}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)} kg (7d)
            </Text>
          )}
        </View>
      ) : (
        <Text style={s.empty}>No weigh-ins yet. Log your weight to track changes.</Text>
      )}

      <View style={[s.row, { marginTop: spacing.sm, gap: spacing.sm }]}>
        <TextInput
          style={[s.bodyInput, { flex: 1 }]}
          value={weightInput}
          onChangeText={setWeightInput}
          placeholder="kg (e.g. 75.5)"
          placeholderTextColor={colors.gray400}
          keyboardType="decimal-pad"
          returnKeyType="done"
        />
        <Pressable
          style={[s.bodyLogBtn, logging && s.btnDisabled]}
          onPress={() => { void handleLog() }}
          disabled={logging}
        >
          <Text style={s.bodyLogBtnText}>{logging ? '...' : 'Log'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton({ height }: { height: number }) {
  return (
    <View style={{ height, borderRadius: radius.md, backgroundColor: colors.gray100 }} />
  )
}

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const today = toLocalISODate()

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['dashboard-summary', today],
    queryFn: () => dashboardApi.summary(today),
  })

  const { data: activeWorkout } = useQuery({
    queryKey: ['workout-active'],
    queryFn: () => workoutsApi.active(),
  })

  const { data: recentList, isLoading: loadingRecent } = useQuery({
    queryKey: ['workouts-list', { limit: 1 }],
    queryFn: () => workoutsApi.list({ limit: 1 }),
  })

  const { data: muscleSplit, isLoading: loadingMuscle } = useQuery({
    queryKey: ['muscle-split', today],
    queryFn: () => dashboardApi.muscleSplit(today, 4),
  })

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
  })

  const lastWorkout = recentList?.items[0] ?? null
  const isResuming = !!activeWorkout

  const handleStartPlan = async (template: WorkoutTemplate) => {
    try {
      const workoutId = await startFromPlan(template)
      void qc.invalidateQueries({ queryKey: ['workout-active'] })
      router.push('/workout')
      void qc.invalidateQueries({ queryKey: ['workout', workoutId] })
    } catch {
      Alert.alert('Error', 'Could not start plan')
    }
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      {/* 1. Start / Resume */}
      <View style={[card, s.cardPad]}>
        <Pressable style={s.startWorkoutBtn} onPress={() => router.push('/workout')}>
          <Text style={s.startWorkoutText}>
            {isResuming ? 'RESUME WORKOUT' : 'START WORKOUT'}
          </Text>
        </Pressable>
        {isResuming && activeWorkout && activeWorkout.started_at && (
          <Text style={s.resumeMeta}>
            Session in progress - {activeDuration(activeWorkout)} elapsed
          </Text>
        )}
      </View>

      {/* 2. Week strip */}
      {loadingSummary ? (
        <Skeleton height={112} />
      ) : summary ? (
        <WeekStrip summary={summary} />
      ) : null}

      {/* 3. Last workout */}
      <View style={[card, s.cardPad]}>
        <Text style={s.sectionTitle}>Last workout</Text>
        {loadingRecent ? (
          <Skeleton height={48} />
        ) : !lastWorkout ? (
          <Text style={s.empty}>No workouts yet. Start your first session.</Text>
        ) : (
          <Pressable onPress={() => router.push(`/history/${lastWorkout.id}`)}>
            <View style={[s.row, { marginTop: spacing.sm }]}>
              <View>
                <Text style={s.planName}>{formatDate(lastWorkout.date)}</Text>
                <Text style={s.planMeta}>
                  {lastWorkout.entries.length} exercise{lastWorkout.entries.length === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.volumeText}>
                  {lastWorkout.total_volume >= 1000
                    ? `${(lastWorkout.total_volume / 1000).toFixed(1)}k`
                    : lastWorkout.total_volume}{' '}
                  kg
                </Text>
                <Text style={s.planMeta}>volume</Text>
              </View>
            </View>
          </Pressable>
        )}
      </View>

      {/* 4. Plans */}
      {loadingTemplates ? (
        <Skeleton height={96} />
      ) : (
        <PlansSection templates={templates} onStart={(t) => void handleStartPlan(t)} />
      )}

      {/* 5. Apple Health */}
      <AppleHealthCard />

      {/* 6. Body */}
      <BodyCard />

      {/* 7. Cardio */}
      <CardioCard />

      {/* 8. Progress */}
      <ProgressChart />

      {/* 9. Muscle split */}
      {loadingMuscle ? (
        <Skeleton height={160} />
      ) : (
        <MuscleSplit data={muscleSplit ?? {}} />
      )}
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: 32 },
  cardPad: { padding: spacing.base },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textSecondary },
  empty: { fontSize: 14, color: colors.gray400, marginTop: spacing.sm },

  // Start / Resume
  startWorkoutBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startWorkoutText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resumeMeta: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },

  // Week strip
  streakBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 6,
  },
  streakText: { fontSize: 12, color: '#1d4ed8', fontWeight: '600' },
  dotsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  dotItem: { alignItems: 'center', gap: 4 },
  dot: { width: 28, height: 28, borderRadius: 14 },
  dotTrained: { backgroundColor: colors.primary },
  dotEmpty: { backgroundColor: colors.gray100 },
  dotLabel: { fontSize: 11, color: colors.gray400 },
  weekSummary: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },

  // Plans
  newPlanBtn: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planName: { fontSize: 14, fontWeight: '500', color: colors.text },
  planMeta: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  startBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  startBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Last workout
  volumeText: { fontSize: 14, fontWeight: '600', color: colors.primary },

  // Progress picker
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginTop: spacing.sm,
  },
  pickerTriggerText: { fontSize: 14, color: colors.text, flex: 1 },
  pickerChevron: { fontSize: 12, color: colors.gray400 },
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerModal: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    top: '30%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...shadow,
  },
  pickerModalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  pickerOption: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  pickerOptionActive: { backgroundColor: colors.gray50 },
  pickerOptionText: { fontSize: 14, color: colors.text },
  pickerOptionTextActive: { color: colors.primary, fontWeight: '600' },

  // Body card
  bodyWeight: { fontSize: 20, fontWeight: '700', color: colors.text },
  bodyDate: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  bodyDelta: { fontSize: 13, fontWeight: '600' },
  bodyDeltaUp: { color: colors.error },
  bodyDeltaDown: { color: colors.success },
  bodyHistoryLink: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  bodyInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  bodyLogBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyLogBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  // Apple Health
  healthBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  healthBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' as const },
  healthBtnSecondary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  healthBtnSecondaryText: { color: colors.gray600, fontSize: 13, fontWeight: '500' as const },

  // Cardio card
  cardioStat: { alignItems: 'center' as const },
  cardioStatVal: { fontSize: 16, fontWeight: '700' as const, color: colors.text },
  cardioStatLabel: { fontSize: 11, color: colors.gray400, marginTop: 2 },

  // Muscle split
  muscleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muscleName: {
    fontSize: 12,
    color: colors.gray600,
    width: 80,
    textTransform: 'capitalize',
  },
  muscleBarBg: {
    flex: 1,
    height: 10,
    backgroundColor: colors.gray100,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  muscleBarFill: { height: '100%', borderRadius: radius.full },
  musclePct: { fontSize: 12, color: colors.gray400, width: 32, textAlign: 'right' },
})
