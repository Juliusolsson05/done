// Days: local calendar days written YYYY-MM-DD, which sort as text.
// Nothing here goes through UTC or toISOString, which can shift a day.
export type Day = string

const two = (n: number) => String(n).padStart(2, '0')
const parts = (day: Day): [number, number, number] => {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m - 1, d]
}

export const dayOf = (d: Date): Day => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
export const toDate = (day: Day): Date => new Date(...parts(day))
export const addDays = (day: Day, n: number): Day => {
  const d = toDate(day)
  d.setDate(d.getDate() + n)
  return dayOf(d)
}
// Date.UTC is used only as a calendar that has no daylight saving, so the
// difference between two days is always a whole number.
export const daysBetween = (a: Day, b: Day): number => Math.round((Date.UTC(...parts(b)) - Date.UTC(...parts(a))) / 864e5)

// The page is reloaded when the day changes, so today is fixed for its lifetime.
export const TODAY: Day = dayOf(new Date())

// The next day that falls on this weekday (0 = Sunday), never today itself:
// "friday" typed on a Friday means next week.
export const nextWeekday = (today: Day, weekday: number): Day =>
  addDays(today, (weekday - toDate(today).getDay() + 7) % 7 || 7)

export function describeDay(day: Day, today: Day): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const date = toDate(day)
  if (diff > 1 && diff < 7) return date.toLocaleDateString('en-GB', { weekday: 'long' })
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
export const fullDay = (day: Day): string =>
  toDate(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDay = (day: Day): string => toDate(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
