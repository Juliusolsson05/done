import { describe, expect, it } from 'vitest'
import { AFTER, BEFORE, initialLeft, LEAD, LEAST, onScreen, paneLayout, spanFor } from '@/lib/timeline-window'

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
    // Day 3 and today (day 11) do not both fit in 8 days with room on the right.
    expect(initialLeft(span, today, '2026-11-15', 8)).toBe(11 - LEAD)
  })

  it('never scrolls past either end', () => {
    expect(initialLeft({ start: '2026-11-21', days: 50 }, today, null, 20)).toBe(0)
    expect(initialLeft({ start: '2026-10-01', days: 60 }, today, null, 20)).toBe(40)
  })
})

describe('how the Timeline divides its width', () => {
  it('gives a phone a narrow title column, a compact header and No date as a section', () => {
    expect(paneLayout(402)).toEqual({ left: 153, compact: true, side: false })
    // Never narrower than a title can be read in.
    expect(paneLayout(320).left).toBe(140)
  })

  it('keeps iPhone landscape and iPad portrait compact, with No date as a section', () => {
    // The content beside the sidebar: 874 pt and 820 pt windows.
    expect(paneLayout(554)).toEqual({ left: 211, compact: true, side: false })
    expect(paneLayout(780).compact).toBe(true)
    expect(paneLayout(780).side).toBe(false)
    expect(paneLayout(780).left).toBe(260)
  })

  it('gives a wide window the full controls and the No date column', () => {
    expect(paneLayout(1100)).toEqual({ left: 260, compact: false, side: true })
  })
})
