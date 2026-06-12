import { describe, it, expect } from 'vitest'
import { toLocalISODate } from './dates'

describe('toLocalISODate', () => {
  it('formats a fixed date correctly', () => {
    const d = new Date(2026, 5, 12) // June 12 2026 local time
    expect(toLocalISODate(d)).toBe('2026-06-12')
  })

  it('pads single-digit months and days', () => {
    const d = new Date(2026, 0, 5) // January 5 2026
    expect(toLocalISODate(d)).toBe('2026-01-05')
  })
})
