// Which days the Timeline draws: from a week before the earliest task (or
// today, if that is earlier) to four weeks after the latest, never fewer
// than five weeks. The whole range is drawn at once, so the scrollbar shows
// all of it from the start, as Notion's and Linear's timelines do; it opens
// on today. Plain data in, plain data out.
import { addDays, daysBetween, type Day } from '@/lib/days'

export interface Span {
  // The first day drawn, and how many are drawn.
  start: Day
  days: number
}

// Days of room before the earliest task and after the latest.
export const BEFORE = 7
export const AFTER = 28
// At least this many days, so a near-empty timeline still has weeks to drag into.
export const LEAST = 35
// How many days before today the timeline opens on.
export const LEAD = 4

export function spanFor(tasks: { start?: Day | null; due?: Day | null }[], today: Day): Span {
  let first = addDays(today, -LEAD)
  let last = today
  for (const t of tasks) {
    const a = t.start ?? t.due
    const b = t.due ?? t.start
    if (a && a < first) first = a
    if (b && b > last) last = b
  }
  const start = addDays(first, -BEFORE)
  const days = Math.max(LEAST, daysBetween(start, last) + 1 + AFTER)
  return { start, days }
}

// The days on screen, for the header: from the first fully or partly visible
// day to the last.
export function onScreen(span: Span, left: number, width: number): [Day, Day] {
  const first = Math.max(0, Math.floor(left))
  const last = Math.min(span.days - 1, Math.ceil(left + width) - 1)
  return [addDays(span.start, first), addDays(span.start, Math.max(first, last))]
}

// On a pane too narrow for NARROW_DAYS days (a phone, at week zoom), four
// days before today would leave today at the right edge and the coming days
// off screen: it gets a single day of room instead.
export const NARROW_DAYS = 10
export const NARROW_LEAD = 1
export const leadFor = (viewDays: number): number => (viewDays < NARROW_DAYS ? NARROW_LEAD : LEAD)

// Days of room kept right of today when the opening position reaches back.
export const RIGHT_ROOM = 2

// Where the Timeline opens, as the first day at the left edge of the bars
// (in days from the span's start): today with LEAD days of room before it
// (one on a narrow pane, leadFor).
// When the earliest bar starts before that and today would still be on
// screen with room to its right, it opens from a day before that bar
// instead, so neither is cut off at the edge. `viewDays`: how many days the
// chart shows at once.
export function initialLeft(span: Span, today: Day, earliest: Day | null, viewDays: number): number {
  const todayAt = daysBetween(span.start, today)
  let left = todayAt - leadFor(viewDays)
  if (earliest) {
    const before = daysBetween(span.start, earliest) - 1
    if (before < left && todayAt - before + 1 + RIGHT_ROOM <= viewDays) left = before
  }
  return Math.max(0, Math.min(left, span.days - Math.ceil(viewDays)))
}

// How the Timeline uses the width it has: whether its controls fit beside
// the title, whether the tasks with no date get a column of their own on the
// right, and whether a row has room for the project dot and who is on the
// task. Decided by the width the view has, not the window's: a Mac window with
// the sidebar open and an iPad in portrait have the same room. The days take
// the whole width of the chart; each task's name is on its own row, above its
// bar (docs/plans/2026-11-27-phone-timeline.md).
export const SIDE_PANEL = 240
export function paneLayout(width: number): { compact: boolean; side: boolean; narrow: boolean } {
  const narrow = width < 500
  // Zoom, grouping, Today, Filter and No date fit beside the title from 880.
  const wide = width >= 880
  return { compact: !wide, side: wide, narrow }
}

// Whether a bar lies wholly off the days on screen, and on which side, so its
// row can say where it went instead of looking empty (an overdue task dated
// before the window). `left` and `width` are the days on screen, in days
// from the span's start; a bar covers its days from `first` to `last`.
export function edgeOf(span: Span, first: Day, last: Day, left: number, width: number): 'before' | 'after' | null {
  if (daysBetween(span.start, last) + 1 <= left) return 'before'
  if (daysBetween(span.start, first) >= left + width) return 'after'
  return null
}
