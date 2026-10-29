import { describe, expect, it } from 'vitest'
import { nextOccurrenceDate } from '../../shared/dates.ts'

describe('next occurrence', () => {
  it('schedules the interval after today', () => {
    expect(nextOccurrenceDate('2026-10-29', 'daily', '2026-10-29')).toBe('2026-10-30')
    expect(nextOccurrenceDate('2026-10-28', 'daily', '2026-10-29')).toBe('2026-10-30')
    expect(nextOccurrenceDate('2026-11-02', 'weekly', '2026-10-29')).toBe('2026-11-09')
    expect(nextOccurrenceDate('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrenceDate('2024-01-31', 'monthly', '2024-01-31')).toBe('2024-02-29')
    expect(nextOccurrenceDate('2026-12-15', 'monthly', '2026-12-15')).toBe('2027-01-15')
    expect(nextOccurrenceDate(null, 'daily', '2026-10-29')).toBe('2026-10-30')
    expect(nextOccurrenceDate('2020-01-01', 'daily', '2026-10-29')).toBe('2026-10-30')
    expect(nextOccurrenceDate('2026-10-01', 'weekly', '2026-10-29')).toBe('2026-11-05')
  })
})