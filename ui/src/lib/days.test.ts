import { describe, expect, it } from 'vitest'
import { addDays, dayOf, daysBetween, describeDay, nextWeekday } from '@/lib/days'

describe('days', () => {
  it('writes a local date as its own calendar day, late at night too', () => {
    // toISOString would call this the 14th or the 12th in most time zones.
    expect(dayOf(new Date(2026, 10, 13, 23, 59))).toBe('2026-11-13')
    expect(dayOf(new Date(2026, 10, 13, 0, 1))).toBe('2026-11-13')
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('counts whole days across a daylight-saving change', () => {
    // Clocks change on 29 March 2026 in Europe and 8 March in the US.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-11-13', '2026-11-10')).toBe(-3)
  })

  it('names the same weekday as next week, never today', () => {
    // 13 November 2026 is a Friday.
    expect(nextWeekday('2026-11-13', 5)).toBe('2026-11-20')
    expect(nextWeekday('2026-11-13', 6)).toBe('2026-11-14')
    expect(nextWeekday('2026-11-13', 1)).toBe('2026-11-16')
  })

  it('describes a day by how near it is', () => {
    const today = '2026-11-13'
    expect(describeDay('2026-11-13', today)).toBe('Today')
    expect(describeDay('2026-11-14', today)).toBe('Tomorrow')
    expect(describeDay('2026-11-12', today)).toBe('Yesterday')
    expect(describeDay('2026-11-17', today)).toBe('Tuesday')
    // A week away the weekday alone would be ambiguous.
    expect(describeDay('2026-11-20', today)).toBe('20 Nov')
    expect(describeDay('2026-11-10', today)).toBe('10 Nov')
  })
})
