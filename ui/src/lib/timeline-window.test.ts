import { describe, expect, it } from 'vitest'
import { AFTER, BEFORE, edgeOf, initialLeft, LEAD, leadFor, LEAST, NARROW_LEAD, onScreen, paneLayout, spanFor } from '@/lib/timeline-window'

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

describe('where the Timeline opens', () => {
  // Span from 2026-11-12 (today is day 11), 50 days.
  const span = { start: '2026-11-12', days: 50 }

  it('opens on today with a few days of room on the left', () => {
    expect(initialLeft(span, today, null, 20)).toBe(11 - LEAD)
  })

  it('reaches back to the earliest bar when today still fits on screen', () => {
    // The earliest bar starts on day 3: shown from a day before it.
    expect(initialLeft(span, today, '2026-11-15', 20)).toBe(2)
  })

  it('keeps today on screen when the earliest bar is too far back', () => {
    // Day 2 and today (day 11) do not both fit in 12 days with room on the right.
    expect(initialLeft(span, today, '2026-11-14', 12)).toBe(11 - LEAD)
  })

  it('leaves a single day before today on a pane too narrow for ten days, so the coming days show', () => {
    expect(leadFor(6)).toBe(NARROW_LEAD)
    expect(NARROW_LEAD).toBe(1)
    expect(leadFor(10)).toBe(LEAD)
    expect(initialLeft(span, today, null, 6)).toBe(11 - NARROW_LEAD)
    // Too narrow to reach back to an earlier bar as well.
    expect(initialLeft(span, today, '2026-11-15', 6)).toBe(10)
  })

  it('never scrolls past either end', () => {
    expect(initialLeft({ start: '2026-11-21', days: 50 }, today, null, 20)).toBe(0)
    expect(initialLeft({ start: '2026-10-01', days: 60 }, today, null, 20)).toBe(40)
  })
})

describe('how the Timeline uses its width', () => {
  it('gives a phone a compact header, rows without dot or faces, and No date as a section', () => {
    expect(paneLayout(402)).toEqual({ compact: true, side: false, narrow: true })
    expect(paneLayout(499).narrow).toBe(true)
  })

  it('keeps iPhone landscape and iPad portrait compact, with No date as a section', () => {
    // The content beside the sidebar: 874 pt and 820 pt windows.
    expect(paneLayout(554)).toEqual({ compact: true, side: false, narrow: false })
    expect(paneLayout(780).compact).toBe(true)
    expect(paneLayout(780).side).toBe(false)
  })

  it('gives a wide window the full controls and the No date column', () => {
    expect(paneLayout(1100)).toEqual({ compact: false, side: true, narrow: false })
  })
})

describe('a bar off the visible days', () => {
  // Span from 2026-11-12; days 10 to 20 on screen.
  const span = { start: '2026-11-12', days: 50 }

  it('is marked at the left edge when it ended before the first day on screen', () => {
    expect(edgeOf(span, '2026-11-13', '2026-11-21', 10, 10)).toBe('before')
  })

  it('is marked at the right edge when it starts after the last day on screen', () => {
    expect(edgeOf(span, '2026-12-02', '2026-12-04', 10, 10)).toBe('after')
  })

  it('is not marked when any of it is on screen, even a part of a day', () => {
    expect(edgeOf(span, '2026-11-13', '2026-11-22', 10, 10)).toBeNull()
    expect(edgeOf(span, '2026-11-13', '2026-11-21', 9.5, 10)).toBeNull()
    // Day 19, the last on screen.
    expect(edgeOf(span, '2026-12-01', '2026-12-04', 10, 10)).toBeNull()
    expect(edgeOf(span, '2026-12-01', '2026-12-04', 8.5, 10)).toBe('after')
  })
})
