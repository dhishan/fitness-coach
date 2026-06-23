/**
 * Browse all workout plans. Tap a plan to view/edit, Start to begin a
 * session from it, or "+ New plan" to create one.
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkoutTemplate } from '@fitness/shared-types'
import { templatesApi } from '../../src/services/api'
import { startFromPlan } from '../../src/lib/startFromPlan'
import { colors, spacing, radius, card } from '../../src/theme'

export default function PlansBrowseScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const [startingId, setStartingId] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery<WorkoutTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    staleTime: 60_000,
  })

  const handleStart = async (t: WorkoutTemplate) => {
    setStartingId(t.id)
    try {
      await startFromPlan(t)
      void qc.invalidateQueries({ queryKey: ['workout', 'active'] })
      router.push('/(tabs)/workout')
    } catch {
      Alert.alert('Error', 'Could not start workout from this plan.')
    } finally {
      setStartingId(null)
    }
  }

  return (
    <View style={s.screen}>
      <Stack.Screen
        options={{
          title: 'Plans',
          headerRight: () => (
            <Pressable onPress={() => router.push('/plans/new')} hitSlop={8}>
              <Text style={s.headerBtn}>+ New</Text>
            </Pressable>
          ),
        }}
      />

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : templates.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>No plans yet</Text>
          <Text style={s.emptySub}>Create a plan to start sessions faster.</Text>
          <Pressable style={s.newPlanCta} onPress={() => router.push('/plans/new')}>
            <Text style={s.newPlanCtaText}>+ New plan</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {templates.map((t) => (
            <View key={t.id} style={[card, s.planRow]}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/plans/${t.id}`)}>
                <Text style={s.planName}>{t.name}</Text>
                <Text style={s.planMeta}>
                  {t.entries.length} exercise{t.entries.length === 1 ? '' : 's'}
                </Text>
              </Pressable>
              <Pressable
                style={[s.startBtn, startingId === t.id && { opacity: 0.6 }]}
                onPress={() => void handleStart(t)}
                disabled={startingId === t.id}
              >
                <Text style={s.startBtnText}>{startingId === t.id ? '...' : 'Start'}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerBtn: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptySub: { fontSize: 14, color: colors.gray500, textAlign: 'center' },
  newPlanCta: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  newPlanCtaText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  list: { padding: spacing.base, gap: spacing.sm },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md },
  planName: { fontSize: 15, fontWeight: '600', color: colors.text },
  planMeta: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  startBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  startBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})
