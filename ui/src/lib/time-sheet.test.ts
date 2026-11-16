import { describe, expect, it } from 'vitest'
import { differenceText, isOver, minutesText, totals, type Entry } from '@/lib/time-sheet'

const MINUTE = 60000
const entry = (plannedMin: number, focusedMs: number): Entry => ({
  id: 1,
  taskId: null,
  title: 'Focus',
  day: '2026-11-16',
  startedAt: 0,
  endedAt: focusedMs,
  plannedMs: plannedMin * MINUTE,
  focusedMs,
})

describe('the time sheet', () => {
  it('writes lengths in minutes, and in hours from an hour up', () => {
    expect(minutesText(45 * MINUTE)).toBe('45 min')
    expect(minutesText(60 * MINUTE)).toBe('1 h')
    expect(minutesText(65 * MINUTE)).toBe('1 h 5 min')
  })

  it('says over or under against the plan in the minutes it shows', () => {
    expect(differenceText(25 * MINUTE, 45 * MINUTE)).toBe('+20 min')
    expect(differenceText(15 * MINUTE, 13 * MINUTE)).toBe('−2 min')
    // 25:20 shows as 25 min, so it reads as on time, not "+0 min".
    expect(differenceText(25 * MINUTE, 25 * MINUTE + 20000)).toBe('on time')
    expect(isOver(25 * MINUTE, 26 * MINUTE)).toBe(true)
    expect(isOver(25 * MINUTE, 24 * MINUTE)).toBe(false)
  })

  // Rounding each row before adding keeps the total row equal to the sum of
  // the rows above it, which is what anyone checking it will add up.
  it('totals the rows as they are shown', () => {
    const sum = totals([entry(25, 12 * MINUTE + 29000), entry(15, 12 * MINUTE + 29000)])
    expect(sum).toEqual({ plannedMs: 40 * MINUTE, focusedMs: 24 * MINUTE })
  })
})
