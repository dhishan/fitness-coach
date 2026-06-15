/**
 * HealthKit service.
 *
 * react-native-health requires a native dev build — it is NOT available in Expo Go.
 * We guard all AppleHealthKit access so the JS bundle loads cleanly in any environment;
 * callers should check isAvailable() before offering the UI.
 *
 * TypeScript: the @types for react-native-health are incomplete / not published as a
 * separate @types package. We import with a ts-ignore to avoid module-not-found errors
 * when the package is present but its types aren't resolved in strict mode.
 */

// @ts-ignore — react-native-health types are bundled inside the package but not always
// resolved by tsc depending on the moduleResolution strategy; runtime access is guarded below
import AppleHealthKitModule from 'react-native-health'

import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { HealthKitSample } from '@fitness/shared-types'
import { api } from './api'

// ---------------------------------------------------------------------------
// Safe reference — undefined when running in Expo Go or non-iOS
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppleHealthKit: any = AppleHealthKitModule ?? undefined

const LAST_SYNCED_KEY = 'healthkit_last_synced_at'

// ---------------------------------------------------------------------------
// Permissions list
// ---------------------------------------------------------------------------

function getPermissions() {
  if (!AppleHealthKit?.Constants?.Permissions) return null
  const P = AppleHealthKit.Constants.Permissions
  return {
    permissions: {
      read: [
        P.BodyMass,
        P.StepCount,
        P.Workout,
        P.HeartRateVariability,
        P.SleepAnalysis,
      ],
      write: [] as string[],
    },
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isAvailable(): boolean {
  // react-native-health is iOS-only; module surface includes initHealthKit + Constants
  const ok =
    Platform.OS === 'ios' &&
    !!AppleHealthKit &&
    typeof AppleHealthKit.initHealthKit === 'function' &&
    !!AppleHealthKit.Constants
  if (!ok) {
    // eslint-disable-next-line no-console
    console.log('[HealthKit] isAvailable=false', {
      platform: Platform.OS,
      moduleTruthy: !!AppleHealthKit,
      hasInit: typeof AppleHealthKit?.initHealthKit,
      hasConstants: !!AppleHealthKit?.Constants,
    })
  }
  return ok
}

export async function init(): Promise<boolean> {
  // Don't gate on isAvailable() — even if the JS-side surface looks partial,
  // try the native call so iOS gets a chance to show the permission prompt.
  if (Platform.OS !== 'ios') return false
  if (typeof AppleHealthKit?.initHealthKit !== 'function') {
    // eslint-disable-next-line no-console
    console.log('[HealthKit] init: native module not linked')
    return false
  }
  const perms = getPermissions()
  if (!perms) {
    // eslint-disable-next-line no-console
    console.log('[HealthKit] init: no Constants.Permissions on module')
    return false
  }

  return new Promise((resolve) => {
    AppleHealthKit.initHealthKit(perms, (err: unknown) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.log('[HealthKit] init error:', err)
      }
      resolve(!err)
    })
  })
}

export async function getLastSyncedAt(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LAST_SYNCED_KEY)
  } catch {
    return null
  }
}

export async function clearLastSyncedAt(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_SYNCED_KEY)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Pull helpers — each wrapped so a permission denial on one type doesn't block others
// ---------------------------------------------------------------------------

function queryWeight(since: Date): Promise<HealthKitSample[]> {
  return new Promise((resolve) => {
    if (!AppleHealthKit?.getSamples) { resolve([]); return }
    const options = {
      startDate: since.toISOString(),
      endDate: new Date().toISOString(),
      type: 'BodyMass',
    }
    AppleHealthKit.getSamples(options, (err: unknown, results: unknown[]) => {
      if (err || !Array.isArray(results)) { resolve([]); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve(results.map((r: any) => ({
        kind: 'weight' as const,
        external_id: r.id ?? r.startDate,
        date: r.startDate?.slice(0, 10) ?? '',
        started_at: r.startDate ?? null,
        ended_at: r.endDate ?? null,
        value: r.value ?? null,
      })))
    })
  })
}

function querySteps(since: Date): Promise<HealthKitSample[]> {
  return new Promise((resolve) => {
    if (!AppleHealthKit?.getDailyStepCountSamples) { resolve([]); return }
    const options = {
      startDate: since.toISOString(),
      endDate: new Date().toISOString(),
    }
    AppleHealthKit.getDailyStepCountSamples(options, (err: unknown, results: unknown[]) => {
      if (err || !Array.isArray(results)) { resolve([]); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve(results.map((r: any) => ({
        kind: 'steps' as const,
        external_id: r.id ?? r.startDate,
        date: r.startDate?.slice(0, 10) ?? '',
        started_at: r.startDate ?? null,
        ended_at: r.endDate ?? null,
        value: r.value ?? null,
      })))
    })
  })
}

function queryHRV(since: Date): Promise<HealthKitSample[]> {
  return new Promise((resolve) => {
    if (!AppleHealthKit?.getSamples) { resolve([]); return }
    const options = {
      startDate: since.toISOString(),
      endDate: new Date().toISOString(),
      type: 'HeartRateVariabilitySDNN',
    }
    AppleHealthKit.getSamples(options, (err: unknown, results: unknown[]) => {
      if (err || !Array.isArray(results)) { resolve([]); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve(results.map((r: any) => ({
        kind: 'hrv' as const,
        external_id: r.id ?? r.startDate,
        date: r.startDate?.slice(0, 10) ?? '',
        started_at: r.startDate ?? null,
        ended_at: r.endDate ?? null,
        value: r.value != null ? r.value * 1000 : null, // convert s -> ms
      })))
    })
  })
}

function querySleep(since: Date): Promise<HealthKitSample[]> {
  return new Promise((resolve) => {
    if (!AppleHealthKit?.getSleepSamples) { resolve([]); return }
    const options = {
      startDate: since.toISOString(),
      endDate: new Date().toISOString(),
    }
    AppleHealthKit.getSleepSamples(options, (err: unknown, results: unknown[]) => {
      if (err || !Array.isArray(results)) { resolve([]); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve(results.map((r: any) => {
        const startMs = r.startDate ? new Date(r.startDate).getTime() : 0
        const endMs = r.endDate ? new Date(r.endDate).getTime() : 0
        const durationMin = endMs > startMs ? Math.round((endMs - startMs) / 60_000) : null
        return {
          kind: 'sleep' as const,
          external_id: r.id ?? r.startDate,
          date: r.startDate?.slice(0, 10) ?? '',
          started_at: r.startDate ?? null,
          ended_at: r.endDate ?? null,
          value: durationMin,
        }
      }))
    })
  })
}

function queryWorkouts(since: Date): Promise<HealthKitSample[]> {
  return new Promise((resolve) => {
    if (!AppleHealthKit?.getAnchoredWorkouts) { resolve([]); return }
    const options = {
      startDate: since.toISOString(),
      endDate: new Date().toISOString(),
    }
    AppleHealthKit.getAnchoredWorkouts(options, (err: unknown, results: { data?: unknown[] }) => {
      if (err || !results?.data || !Array.isArray(results.data)) { resolve([]); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve(results.data.map((r: any) => {
        const durationS = r.duration ?? null
        const distM = r.distance != null ? r.distance * 1000 : null
        return {
          kind: 'workout' as const,
          external_id: r.id ?? r.startDate,
          date: r.startDate?.slice(0, 10) ?? '',
          started_at: r.startDate ?? null,
          ended_at: r.endDate ?? null,
          workout_type: r.activityName ?? null,
          duration_s: durationS != null ? Math.round(durationS) : null,
          distance_m: distM != null ? Math.round(distM) : null,
          calories: r.totalEnergyBurned != null ? Math.round(r.totalEnergyBurned) : null,
          avg_hr: r.averageHeartRate != null ? Math.round(r.averageHeartRate) : null,
        }
      }))
    })
  })
}

// ---------------------------------------------------------------------------
// pullSince — idempotent; caller provides since date
// ---------------------------------------------------------------------------

export async function pullSince(since: Date): Promise<HealthKitSample[]> {
  const results = await Promise.allSettled([
    queryWeight(since),
    querySteps(since),
    queryHRV(since),
    querySleep(since),
    queryWorkouts(since),
  ])

  const samples: HealthKitSample[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') samples.push(...r.value)
  }
  return samples
}

// ---------------------------------------------------------------------------
// syncToBackend — pull since lastSyncedAt (or since), POST, store new timestamp
// ---------------------------------------------------------------------------

export async function syncToBackend(since: Date): Promise<{ imported: Record<string, number>; skipped: number }> {
  const samples = await pullSince(since)

  if (samples.length === 0) {
    const now = new Date().toISOString()
    await SecureStore.setItemAsync(LAST_SYNCED_KEY, now)
    return { imported: { weight: 0, steps: 0, workouts: 0, hrv: 0, sleep: 0 }, skipped: 0 }
  }

  const result = await api.post<{ imported: Record<string, number>; skipped: number }>(
    '/healthkit/sync',
    { samples },
  ).then((r) => r.data)

  const now = new Date().toISOString()
  await SecureStore.setItemAsync(LAST_SYNCED_KEY, now)

  return result
}
