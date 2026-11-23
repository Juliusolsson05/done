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
