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

// Calendar arithmetic for dates typed in words. Months count from 1 here, as
// they are written.
export const ymd = (day: Day): [number, number, number] => {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}
export const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate()
// Null for a day the calendar does not have (30 February), so typed text can
// never become an impossible date.
export const realDay = (year: number, month: number, day: number): Day | null =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? `${year}-${two(month)}-${two(day)}` : null
// A month after 31 January is the last day of February: a day the month does
// not have becomes its last one instead of spilling into the next month.
export const addMonths = (day: Day, n: number): Day => {
  const [y, m, d] = ymd(day)
  const months = y * 12 + (m - 1) + n
  const year = Math.floor(months / 12)
  const month = (months % 12) + 1
  return `${year}-${two(month)}-${two(Math.min(d, daysInMonth(year, month)))}`
}
// A typed date said back so it cannot be misread: "next friday" is "Fri 20 Nov".
export function spellDay(day: Day, today: Day): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  const year = day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric'
  // Some engines put a comma after the weekday and some do not.
  return toDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year }).replace(',', '')
}
