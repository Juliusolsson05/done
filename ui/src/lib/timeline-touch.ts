// How wide a day is on the touch Timeline (iPhone and iPad), and what its
// date header labels. A day is fitted to the room the chart has, so a phone
// shows a readable week and an iPad uses its width, instead of one fixed
// number of pixels everywhere. Plain data in, plain data out.
// The Mac Timeline keeps its own fixed widths (timeline-layout's DAY_PX).

export type TouchZoom = 'day' | 'week' | 'month' | 'quarter'
export const TOUCH_ZOOMS: TouchZoom[] = ['day', 'week', 'month', 'quarter']
export const DEFAULT_ZOOM: TouchZoom = 'week'

// Per zoom: how many days should fit across the chart, and the narrowest and
// widest a day may be. A day is never under 44 px at Week or Day, the size a
// finger can hit (Apple's 44 points); Week tops out at 72 so an iPad shows a
// couple of weeks rather than one stretched week.
export const FIT: Record<TouchZoom, { days: number; least: number; most: number }> = {
  day: { days: 5, least: 64, most: 112 },
  week: { days: 7, least: 44, most: 72 },
  month: { days: 31, least: 12, most: 28 },
  quarter: { days: 91, least: 4, most: 10 },
}

// Pixels a day takes, given the width of the chart in pixels.
export function dayWidth(zoom: TouchZoom, chartWidth: number): number {
  const { days, least, most } = FIT[zoom]
  return Math.min(most, Math.max(least, Math.floor(chartWidth / days)))
}

// The zoom remembered on this device. `saved` is this view's own key;
// `shared` the key the Mac Timeline also uses (week, month or quarter),
// read so a choice made before this view had its own key carries over.
export function parseZoom(saved: string | null, shared: string | null): TouchZoom {
  if (TOUCH_ZOOMS.includes(saved as TouchZoom)) return saved as TouchZoom
  if (shared === 'month' || shared === 'quarter') return shared
  return DEFAULT_ZOOM
}

// What the date header labels at a width of day:
// - 'days': every day, its weekday letter over its date;
// - 'weeks': each Monday, short weekday over its date;
// - 'dates': each Monday's date alone (too little room for the weekday).
export type Ticks = 'days' | 'weeks' | 'dates'
export function ticks(px: number): Ticks {
  if (px >= 32) return 'days'
  if (px * 7 >= 56) return 'weeks'
  return 'dates'
}

// Days drawn: the span the tasks need, or more when the chart is wider than
// that at this zoom (Quarter on a phone), so the days reach its right edge.
export function daysToFill(spanDays: number, chartWidth: number, px: number): number {
  return Math.max(spanDays, Math.ceil(chartWidth / px))
}
