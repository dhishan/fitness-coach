/**
 * Weight unit helpers. Backend always stores kg; the UI displays + edits
 * in the user's chosen unit.
 *
 * Mirror of mobile/src/store/units.ts conversion helpers.
 */

export type WeightUnit = 'kg' | 'lb'

const KG_PER_LB = 0.45359237

/** Convert a backend kg value to the user's display unit. */
export function kgToDisplay(kg: number, unit: WeightUnit): number {
  if (unit === 'lb') return kg / KG_PER_LB
  return kg
}

/** Convert a user-entered display value back to kg for the backend. */
export function displayToKg(value: number, unit: WeightUnit): number {
  if (unit === 'lb') return value * KG_PER_LB
  return value
}

/** Returns the unit label string ('kg' or 'lb'). */
export function weightLabel(unit: WeightUnit): string {
  return unit
}

/** Default step size that feels natural per unit (2.5 kg ~ 5 lb). */
export function weightStep(unit: WeightUnit): number {
  return unit === 'lb' ? 5 : 2.5
}

/**
 * Format a weight value for display.
 * 0 decimal places for whole numbers, 1 for fractions.
 */
export function formatWeight(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded)
}
