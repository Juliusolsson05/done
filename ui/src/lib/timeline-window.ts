// Which days the Timeline has drawn. It starts with a few weeks around today
// and grows by three weeks whenever scrolling nears either end, so it can be
// scrolled back or forward as far as anyone wants, without drawing years of
// empty days up front. Plain numbers in, plain numbers out.
import { addDays, daysBetween, type Day } from '@/lib/days'

export interface Span {
  // The first day drawn, and how many are drawn.
  start: Day
  days: number
}

// Days added at a time, and how close to an end (in days) adds them.
export const GROW = 21
export const NEAR = 4

// Before the first drawing: three weeks before the usual start, so the
// timeline can be scrolled back at once, and the usual 35 days after.
export const around = (start: Day): Span => ({ start: addDays(start, -GROW), days: GROW + 35 })

// What to draw after scrolling to `left` (in days from the first drawn day)
// with `width` days on screen. `shift` is how many days were put in front,
// so the scroll position can move by as much and nothing jumps.
export function grown(span: Span, left: number, width: number): { span: Span; shift: number } {
  let { start, days } = span
  let shift = 0
  if (left < NEAR) {
    start = addDays(start, -GROW)
    days += GROW
    shift = GROW
  }
  if (left + width > days - NEAR) days += GROW
  return { span: { start, days }, shift }
}

// Drawn far enough back to show `day` with a few days before it; how many
// days were put in front.
export function reaching(span: Span, day: Day): { span: Span; shift: number } {
  const missing = daysBetween(day, span.start) + NEAR
  if (missing <= 0) return { span, shift: 0 }
  const shift = Math.ceil(missing / GROW) * GROW
  return { span: { start: addDays(span.start, -shift), days: span.days + shift }, shift }
}

// The days on screen, for the header: from the first fully or partly visible
// day to the last.
export function onScreen(span: Span, left: number, width: number): [Day, Day] {
  const first = Math.max(0, Math.floor(left))
  const last = Math.min(span.days - 1, Math.ceil(left + width) - 1)
  return [addDays(span.start, first), addDays(span.start, Math.max(first, last))]
}
