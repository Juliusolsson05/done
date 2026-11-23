import { describe, expect, it } from 'vitest'
import { AFTER, BEFORE, LEAST, onScreen, spanFor } from '@/lib/timeline-window'

const today = '2026-11-23'

describe('the days the Timeline draws', () => {
  it('runs from a week before the earliest task to four weeks after the latest', () => {
    const span = spanFor([{ start: '2026-09-01', due: '2026-09-20' }, { due: '2026-12-10' }], today)
    expect(span.start).toBe('2026-08-25')
    expect(span.days).toBe(108 + AFTER)
  })

  it('always has today in it, with room before, even when every task is later', () => {
    const span = spanFor([{ due: '2027-02-01' }], today)
    expect(span.start).toBe('2026-11-12')
    expect(spanFor([], today)).toEqual({ start: '2026-11-12', days: Math.max(LEAST, 12 + AFTER) })
  })

  it('counts a task with only a start, or only a due date', () => {
    expect(spanFor([{ start: '2026-10-01' }], today).start).toBe('2026-09-24')
    expect(BEFORE).toBe(7)
  })

  it('names the days on screen', () => {
    const span = spanFor([], today)
    expect(onScreen(span, 11, 14)).toEqual(['2026-11-23', '2026-12-06'])
  })
})
