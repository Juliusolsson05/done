// The time sheet: one row per focus block that has ended, read a day at a
// time. Plain data in, plain data out; the rows are saved by the backend.
import type { Day } from '@/lib/days'

// The shapes `crates/core` stores (Entry and NewEntry there).
export interface NewEntry {
  taskId: number | null
  // The title when the block ran, so a renamed or deleted task still reads.
  title: string
  // The local day the block started on.
  day: Day
  // Milliseconds since 1970.
  startedAt: number
  endedAt: number
  // The length the block was started with; asking for more time leaves it.
  plannedMs: number
  // Time spent focusing: pauses and reminder breaks left out, extra time in.
  focusedMs: number
}

export interface Entry extends NewEntry {
  id: number
}

const MINUTE = 60000

// Whole minutes, as the sheet shows them. Differences and totals are worked
// out from these rounded numbers, so what is shown always adds up.
export const minutes = (ms: number): number => Math.round(ms / MINUTE)

// 45 min, or 1 h 5 min from an hour up.
export function minutesText(ms: number): string {
  const m = minutes(ms)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h` + (m % 60 ? ` ${m % 60} min` : '')
}

// Took longer than planned is positive. Written with a real minus sign.
export function differenceText(plannedMs: number, focusedMs: number): string {
  const diff = minutes(focusedMs) - minutes(plannedMs)
  if (diff === 0) return 'on time'
  return (diff > 0 ? '+' : '−') + minutesText(Math.abs(diff) * MINUTE)
}
export const isOver = (plannedMs: number, focusedMs: number): boolean => minutes(focusedMs) > minutes(plannedMs)

export function totals(entries: Entry[]): { plannedMs: number; focusedMs: number } {
  return {
    plannedMs: entries.reduce((sum, e) => sum + minutes(e.plannedMs) * MINUTE, 0),
    focusedMs: entries.reduce((sum, e) => sum + minutes(e.focusedMs) * MINUTE, 0),
  }
}

// 09:05, on the Mac's own clock.
export const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
