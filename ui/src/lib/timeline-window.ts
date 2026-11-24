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

// Days of room kept right of today when the opening position reaches back.
export const RIGHT_ROOM = 2

// Where the Timeline opens, as the first day at the left edge of the bars
// (in days from the span's start): today with LEAD days of room before it.
// When the earliest bar starts before that and today would still be on
// screen with room to its right, it opens from a day before that bar
// instead, so neither is cut off at the edge. `viewDays`: how many days the
// chart shows at once.
export function initialLeft(span: Span, today: Day, earliest: Day | null, viewDays: number): number {
  const todayAt = daysBetween(span.start, today)
  let left = todayAt - LEAD
  if (earliest) {
    const before = daysBetween(span.start, earliest) - 1
    if (before < left && todayAt - before + 1 + RIGHT_ROOM <= viewDays) left = before
  }
  return Math.max(0, Math.min(left, span.days - Math.ceil(viewDays)))
}

// How the Timeline divides the width it has: the column of titles on the
// left, whether its controls go into one View menu, and whether the tasks
// with no date get a column of their own on the right. Decided by the width
// the view has, not the window's: a Mac window with the sidebar open and an
// iPad in portrait have the same room.
export const SIDE_PANEL = 240
export function paneLayout(width: number): { left: number; compact: boolean; side: boolean } {
  // A phone gives the titles a bit over a third, never so little that a
  // title cannot be read; from 700 the column is as wide as on the Mac.
  const left = width < 700 ? Math.min(260, Math.max(140, Math.round(width * 0.38))) : 260
  // Zoom, grouping, Today, Filter and No date fit beside the title from 880.
  const wide = width >= 880
  return { left, compact: !wide, side: wide }
}
