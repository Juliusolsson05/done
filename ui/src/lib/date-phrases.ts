// Dates written in words inside a typed line: "tomorrow", "next friday",
// "in 3 days", "5 jan", "24/12". English only, no times, nothing repeating.
//
// The rules that had to be chosen:
// - A bare weekday is the next such day strictly after today, so "monday"
//   typed on a Monday is next week's. "this monday" counts today.
// - "next friday" is the Friday of the following week (weeks start on
//   Monday), not the nearest Friday.
// - A month and day with no year means next year once it has passed this
//   year. Today itself has not passed.
// - Numbers are day first, as written in Sweden: 24/12 is 24 December.
// - Text that would be an impossible day (30 February) is not a date.
// - Nothing here guesses at meaning. "friday night lights" is due Friday; the
//   way out is Backspace, which dismisses a phrase (see the end of the file).
import { addDays, addMonths, daysInMonth, nextWeekday, realDay, toDate, ymd, type Day } from '@/lib/days'

const WEEKDAY: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
}
// "sat" and "sun" alone are ordinary words ("sat down in the sun"), so they
// are read only after a word that makes them a day: "on sat", "next sun".
const WEEKDAY_AFTER_A_WORD: Record<string, number> = { ...WEEKDAY, sat: 6, sun: 0 }
const MONTH: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

const any = (words: Record<string, number>) => Object.keys(words).join('|')
const WD = any(WEEKDAY)
const WD_ALL = any(WEEKDAY_AFTER_A_WORD)
const MON = any(MONTH)
const NTH = '(?:st|nd|rd|th)'
// A year after a month and day is part of the date only if it can be one:
// four digits, 1900 to 2100. In "jan 5 300 units" the 300 stays in the title.
const YEAR = String.raw`(?:,?\s+(19\d\d|20\d\d|2100))?`
const COUNT = String.raw`(\d{1,3}|an?|one)\s+(day|week|month|year)s?`

const weekdayOf = (day: Day): number => toDate(day).getDay()
// Weeks start on Monday here.
const nextMonday = (today: Day): Day => addDays(today, 7 - ((weekdayOf(today) + 6) % 7))
// The next such weekday, today included.
const comingWeekday = (today: Day, weekday: number): Day => addDays(today, (weekday - weekdayOf(today) + 7) % 7)

// Days sort as text, so `>=` compares them.
function comingMonthDay(today: Day, month: number, dayOfMonth: number): Day | null {
  const [year] = ymd(today)
  // Eight years reach the next 29 February from anywhere, also across 2100.
  for (let y = year; y <= year + 8; y++) {
    const day = realDay(y, month, dayOfMonth)
    if (day && day >= today) return day
  }
  return null
}

// With its year a day is taken as written; without, it is the coming one.
const monthDay = (today: Day, month: number, dayOfMonth: number, year: string | undefined): Day | null =>
  year === undefined ? comingMonthDay(today, month, dayOfMonth) : realDay(Number(year), month, dayOfMonth)

// "the 31st" is the next month that has one.
function comingDayOfMonth(today: Day, dayOfMonth: number): Day | null {
  const [year, month] = ymd(today)
  for (let i = 0; i <= 12; i++) {
    const day = realDay(year + Math.floor((month - 1 + i) / 12), ((month - 1 + i) % 12) + 1, dayOfMonth)
    if (day && day >= today) return day
  }
  return null
}

function counted(today: Day, count: string, unit: string): Day {
  const n = /\d/.test(count) ? Number(count) : 1
  const u = unit.toLowerCase()
  if (u === 'day') return addDays(today, n)
  if (u === 'week') return addDays(today, 7 * n)
  return addMonths(today, u === 'month' ? n : 12 * n)
}

// "26" is 2026: nobody plans a task for 1926.
const fullYear = (written: string): number => (written.length === 2 ? 2000 + Number(written) : Number(written))
const dayFirst = (today: Day, d: string, m: string, y: string | undefined): Day | null =>
  monthDay(today, Number(m), Number(d), y === undefined ? y : String(fullYear(y)))

type Rule = [pattern: string, day: (m: RegExpExecArray, today: Day) => Day | null]

const RULES: Rule[] = [
  ['today|tod|tonight', (_, today) => today],
  // "tom" is left out on purpose: it is a name.
  ['tomorrow|tmrw?', (_, today) => addDays(today, 1)],
  [String.raw`(?:the\s+)?day\s+after\s+tomorrow`, (_, today) => addDays(today, 2)],

  [`(${WD})`, (m, today) => nextWeekday(today, WEEKDAY[m[1].toLowerCase()])],
  [String.raw`(?:on|by|due)\s+(sat|sun)`, (m, today) => nextWeekday(today, WEEKDAY_AFTER_A_WORD[m[1].toLowerCase()])],
  [String.raw`this\s+(${WD_ALL})`, (m, today) => comingWeekday(today, WEEKDAY_AFTER_A_WORD[m[1].toLowerCase()])],
  [String.raw`next\s+(${WD_ALL})`, (m, today) => addDays(nextMonday(today), (WEEKDAY_AFTER_A_WORD[m[1].toLowerCase()] + 6) % 7)],

  [String.raw`next\s+week`, (_, today) => nextMonday(today)],
  [String.raw`next\s+month`, (_, today) => addMonths(today.slice(0, 8) + '01', 1)],
  // On a Sunday the weekend is already on, so it is today.
  [String.raw`(?:this\s+)?weekend`, (_, today) => (weekdayOf(today) === 0 ? today : comingWeekday(today, 6))],
  [String.raw`next\s+weekend`, (_, today) => addDays(nextMonday(today), 5)],
  [String.raw`end\s+of\s+(?:the\s+)?week|eow`, (_, today) => comingWeekday(today, 5)],
  [String.raw`end\s+of\s+(?:the\s+)?month|eom`, (_, today) => today.slice(0, 8) + daysInMonth(ymd(today)[0], ymd(today)[1])],
  [String.raw`end\s+of\s+(?:the\s+)?year|eoy`, (_, today) => today.slice(0, 4) + '-12-31'],

  [String.raw`in\s+${COUNT}`, (m, today) => counted(today, m[1], m[2])],
  [String.raw`${COUNT}\s+from\s+now`, (m, today) => counted(today, m[1], m[2])],

  [String.raw`(${MON})\s+(\d{1,2})${NTH}?${YEAR}`, (m, today) => monthDay(today, MONTH[m[1].toLowerCase()], Number(m[2]), m[3])],
  [
    String.raw`(?:the\s+)?(\d{1,2})${NTH}?\s+(?:of\s+)?(${MON})${YEAR}`,
    (m, today) => monthDay(today, MONTH[m[2].toLowerCase()], Number(m[1]), m[3]),
  ],
  // A number alone is never a date; "5th" is.
  [String.raw`(?:the\s+)?(\d{1,2})${NTH}`, (m, today) => comingDayOfMonth(today, Number(m[1]))],

  [String.raw`(\d{4})-(\d{2})-(\d{2})`, (m) => realDay(Number(m[1]), Number(m[2]), Number(m[3]))],
  [String.raw`(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?`, (m, today) => dayFirst(today, m[1], m[2], m[3])],
  [String.raw`(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})`, (m, today) => dayFirst(today, m[1], m[2], m[3])],
  // Without a year both parts need two digits, so "1.5 kg" and "v1.2" are
  // never dates.
  [String.raw`(\d{2})\.(\d{2})`, (m, today) => dayFirst(today, m[1], m[2], undefined)],
]

// An "on", "by" or "due" directly before a date belongs to it and leaves the
// title with it: "pay rent by friday" is "pay rent".
const LEAD = String.raw`(?:(?:on|by|due)\s+)?`
// Whole words only. A phrase ends at the end of the line, at a space, or at
// punctuation, a closing bracket or a quote followed by one of those:
// "today," and "(today)" but not "monday.com" or "today's".
const END = String.raw`(?=[.,;:!?)\]"']*(?:\s|$))`
const COMPILED = RULES.map(([pattern, day]) => ({ re: new RegExp(`${LEAD}(?:${pattern})${END}`, 'iy'), day }))
// ...and starts at the start of the line, after a space, an opening bracket
// or a quote.
const startsWord = (text: string, i: number): boolean => i === 0 || /[\s(["']/.test(text[i - 1])

export interface Phrase {
  start: number
  end: number
  day: Day
}

// A phrase the user said is not a date, remembered by its words and place.
export interface Dismissed {
  start: number
  end: number
  words: string
}

// Every phrase in the line, left to right. At each word the longest reading
// wins, so "next friday" is never read as "friday", and a longest reading
// that is an impossible day ("31st april") is no date at all rather than a
// shorter one ("31st").
function phrases(text: string, today: Day): Phrase[] {
  const found: Phrase[] = []
  let i = 0
  while (i < text.length) {
    let end = i
    let day: Day | null = null
    if (startsWord(text, i)) {
      for (const rule of COMPILED) {
        rule.re.lastIndex = i
        const m = rule.re.exec(text)
        if (m && rule.re.lastIndex > end) {
          end = rule.re.lastIndex
          day = rule.day(m, today)
        }
      }
    }
    if (day) found.push({ start: i, end, day })
    i = Math.max(end, i + 1)
  }
  return found
}

// The date of a typed line: the last phrase in it that has not been
// dismissed, as Todoist does, or null.
export function findDate(text: string, today: Day, dismissed: Dismissed[] = []): Phrase | null {
  const isDismissed = (p: Phrase) => dismissed.some((d) => d.start === p.start && d.end === p.end && d.words === text.slice(p.start, p.end))
  return (
    phrases(text, today)
      .filter((p) => !isDismissed(p))
      .at(-1) ?? null
  )
}

// Backspace with the caret directly after the recognised phrase and nothing
// selected does not delete: it says "this is not a date". Returns what to
// remember, or null when Backspace should just delete.
export function dismissOnBackspace(text: string, selectionStart: number | null, selectionEnd: number | null, found: Phrase | null): Dismissed | null {
  if (!found || selectionStart !== selectionEnd || selectionEnd !== found.end) return null
  return { start: found.start, end: found.end, words: text.slice(found.start, found.end) }
}

// What is still dismissed after the line changed from `before` to `after`.
// The change is taken to be the part between what the two lines share at the
// start and at the end. A dismissal before it stays, one after it moves with
// its words, and one it touches is dropped, so words that were edited are
// read afresh.
export function carryDismissed(dismissed: Dismissed[], before: string, after: string): Dismissed[] {
  const shortest = Math.min(before.length, after.length)
  let head = 0
  while (head < shortest && before[head] === after[head]) head++
  let tail = 0
  while (tail < shortest - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const moved = after.length - before.length
  const kept: Dismissed[] = []
  for (const d of dismissed) {
    if (d.end <= head) kept.push(d)
    else if (d.start >= before.length - tail) kept.push({ ...d, start: d.start + moved, end: d.end + moved })
  }
  return kept
}
