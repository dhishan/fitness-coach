/**
 * Weight unit preference. Backend always stores kg; the UI displays + edits
 * in the user's chosen unit.
 *
 * Read with `useWeightUnit()`. Mutate via `setWeightUnit('lb' | 'kg')`. The
 * setting lives in SecureStore so it survives reinstall.
 */
import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

const KEY = 'fitness-units'
const KG_PER_LB = 0.45359237

type State = {
  unit: 'kg' | 'lb'
  hydrated: boolean
  hydrate: () => Promise<void>
  set: (u: 'kg' | 'lb') => Promise<void>
}

export const useUnitStore = create<State>((setState) => ({
  unit: 'kg',
  hydrated: false,
  hydrate: async () => {
    try {
      const v = await SecureStore.getItemAsync(KEY)
      setState({ unit: v === 'lb' ? 'lb' : 'kg', hydrated: true })
    } catch {
      setState({ hydrated: true })
    }
  },
  set: async (u) => {
    setState({ unit: u })
    try {
      await SecureStore.setItemAsync(KEY, u)
    } catch {
      // best-effort
    }
  },
}))

export function useWeightUnit(): 'kg' | 'lb' {
  return useUnitStore((s) => s.unit)
}

// Backend stores kg; UI shows in user's unit.
export function kgToDisplay(kg: number, unit: 'kg' | 'lb'): number {
  if (unit === 'lb') return kg / KG_PER_LB
  return kg
}

export function displayToKg(value: number, unit: 'kg' | 'lb'): number {
  if (unit === 'lb') return value * KG_PER_LB
  return value
}

// Default step size that feels natural per unit (2.5 kg ≈ 5 lb).
export function stepFor(unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? 5 : 2.5
}

// Format for display: 0 decimals for whole numbers, 1 for fractions.
export function formatWeight(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded)
}
