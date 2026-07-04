/**
 * Zustand store for the user's weight display preference.
 * Persists to localStorage using the same key as SettingsSheet.tsx so both
 * sources stay in sync.
 */
import { create } from 'zustand'
import type { WeightUnit } from '../lib/units'

const UNIT_KEY = 'fitness-unit-pref'

interface UnitsStore {
  unit: WeightUnit
  setUnit: (u: WeightUnit) => void
}

export const useUnitsStore = create<UnitsStore>((set) => ({
  unit: (localStorage.getItem(UNIT_KEY) as WeightUnit) ?? 'kg',
  setUnit: (u) => {
    localStorage.setItem(UNIT_KEY, u)
    set({ unit: u })
  },
}))
