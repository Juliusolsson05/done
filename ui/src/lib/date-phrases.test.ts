import { describe, expect, it } from 'vitest'
import { carryDismissed, dismissOnBackspace, findDate, type Dismissed } from '@/lib/date-phrases'

const FRI = '2026-11-13' // a Friday; its week is Mon 9 to Sun 15
const MON = '2026-11-09' // the Monday of that week
const SUN = '2026-11-15' // the Sunday of that week
const SAT31 = '2026-01-31' // a Saturday and a 31st, before a month with 28 days
const LEAP = '2028-02-29' // a Tuesday and a leap day

// [today, what is typed, the day it means]
const DATES: [string, string, string][] = [
  // today and tomorrow
  [FRI, 'today', '2026-11-13'],
  [FRI, 'tod', '2026-11-13'],
  [FRI, 'tonight', '2026-11-13'],
  [FRI, 'tomorrow', '2026-11-14'],
  [FRI, 'tmr', '2026-11-14'],
  [FRI, 'tmrw', '2026-11-14'],
  [FRI, 'day after tomorrow', '2026-11-15'],
  [FRI, 'the day after tomorrow', '2026-11-15'],
  [SAT31, 'tomorrow', '2026-02-01'],
  [LEAP, 'tomorrow', '2028-03-01'],
  [LEAP, 'day after tomorrow', '2028-03-02'],

  // a bare weekday: the next one strictly after today
  [FRI, 'monday', '2026-11-16'],
  [FRI, 'tuesday', '2026-11-17'],
  [FRI, 'wednesday', '2026-11-18'],
  [FRI, 'thursday', '2026-11-19'],
  [FRI, 'friday', '2026-11-20'],
  [FRI, 'saturday', '2026-11-14'],
  [FRI, 'sunday', '2026-11-15'],
  [FRI, 'mon', '2026-11-16'],
  [FRI, 'tue', '2026-11-17'],
  [FRI, 'tues', '2026-11-17'],
  [FRI, 'wed', '2026-11-18'],
  [FRI, 'thu', '2026-11-19'],
  [FRI, 'thur', '2026-11-19'],
  [FRI, 'thurs', '2026-11-19'],
  [FRI, 'fri', '2026-11-20'],
  [MON, 'monday', '2026-11-16'],
  [MON, 'friday', '2026-11-13'],
  [SAT31, 'saturday', '2026-02-07'],
  [SAT31, 'sunday', '2026-02-01'],
  [LEAP, 'tuesday', '2028-03-07'],
  [LEAP, 'wednesday', '2028-03-01'],

  // "on", "this" and "next" with a weekday
  [FRI, 'on friday', '2026-11-20'],
  [FRI, 'on sat', '2026-11-14'],
  [FRI, 'this sun', '2026-11-15'],
  [FRI, 'this friday', '2026-11-13'],
  [FRI, 'this monday', '2026-11-16'],
  [MON, 'this monday', '2026-11-09'],
  [SAT31, 'this saturday', '2026-01-31'],
  // "next friday" is the Friday of the following week, not the nearest one.
  [MON, 'next friday', '2026-11-20'],
  [MON, 'next monday', '2026-11-16'],
  [FRI, 'next friday', '2026-11-20'],
  [FRI, 'next monday', '2026-11-16'],
  [FRI, 'next sunday', '2026-11-22'],
  [FRI, 'next sat', '2026-11-21'],
  [SUN, 'next monday', '2026-11-16'],
  [SUN, 'next sunday', '2026-11-22'],
  [SAT31, 'next friday', '2026-02-06'],
  [LEAP, 'next tuesday', '2028-03-07'],

  // weeks, months, weekends and ends
  [FRI, 'next week', '2026-11-16'],
  [SAT31, 'next week', '2026-02-02'],
  [FRI, 'next month', '2026-12-01'],
  [SAT31, 'next month', '2026-02-01'],
  [LEAP, 'next month', '2028-03-01'],
  [FRI, 'weekend', '2026-11-14'],
  [FRI, 'this weekend', '2026-11-14'],
  [SAT31, 'weekend', '2026-01-31'],
  [SUN, 'this weekend', '2026-11-15'],
  [LEAP, 'weekend', '2028-03-04'],
  [FRI, 'next weekend', '2026-11-21'],
  [SUN, 'next weekend', '2026-11-21'],
  [SAT31, 'next weekend', '2026-02-07'],
  [FRI, 'end of week', '2026-11-13'],
  [FRI, 'eow', '2026-11-13'],
  [MON, 'end of the week', '2026-11-13'],
  [SUN, 'end of week', '2026-11-20'],
  [SAT31, 'eow', '2026-02-06'],
  [FRI, 'end of month', '2026-11-30'],
  [FRI, 'eom', '2026-11-30'],
  [SAT31, 'end of the month', '2026-01-31'],
  [LEAP, 'eom', '2028-02-29'],
  [FRI, 'end of year', '2026-12-31'],
  [FRI, 'eoy', '2026-12-31'],
  [LEAP, 'end of the year', '2028-12-31'],

  // counted from today
  [FRI, 'in 3 days', '2026-11-16'],
  [FRI, 'in 1 day', '2026-11-14'],
  [FRI, 'in a week', '2026-11-20'],
  [FRI, 'in 2 weeks', '2026-11-27'],
  [FRI, 'in a month', '2026-12-13'],
  [FRI, 'in 2 months', '2027-01-13'],
  [FRI, 'in a year', '2027-11-13'],
  [FRI, '3 days from now', '2026-11-16'],
  [FRI, 'a week from now', '2026-11-20'],
  [SAT31, 'in a month', '2026-02-28'],
  [SAT31, 'in 2 months', '2026-03-31'],
  [SAT31, 'in 1 day', '2026-02-01'],
  [LEAP, 'in a year', '2029-02-28'],
  [LEAP, 'in 4 years', '2032-02-29'],
  [LEAP, 'in a month', '2028-03-29'],

  // a month and a day: next year once it has passed, and today has not passed
  [FRI, 'jan 5', '2027-01-05'],
  [FRI, 'january 5', '2027-01-05'],
  [FRI, '5 jan', '2027-01-05'],
  [FRI, '5 january', '2027-01-05'],
  [FRI, 'jan 5th', '2027-01-05'],
  [FRI, 'the 5th of january', '2027-01-05'],
  [FRI, '5th of jan', '2027-01-05'],
  [FRI, 'dec 24', '2026-12-24'],
  [FRI, '1st december', '2026-12-01'],
  [FRI, 'sept 2nd', '2027-09-02'],
  [FRI, 'nov 13', '2026-11-13'],
  [FRI, 'nov 12', '2027-11-12'],
  [FRI, 'feb 29', '2028-02-29'],
  [SAT31, 'jan 30', '2027-01-30'],
  [SAT31, '31 january', '2026-01-31'],
  [LEAP, 'feb 29', '2028-02-29'],
  [LEAP, 'feb 28', '2029-02-28'],

  // a year written after it: that exact day, passed or not
  [FRI, 'jan 5 2027', '2027-01-05'],
  [FRI, 'january 5, 2027', '2027-01-05'],
  [FRI, '5 jan 2027', '2027-01-05'],
  [FRI, '5th of january 2027', '2027-01-05'],
  [FRI, 'the 5th of january, 2028', '2028-01-05'],
  [FRI, 'jan 5th 2026', '2026-01-05'],
  [FRI, 'dec 24 2100', '2100-12-24'],
  [LEAP, 'feb 29 2032', '2032-02-29'],

  // a day alone: the next such day of a month, today included
  [FRI, '5th', '2026-12-05'],
  [FRI, 'the 21st', '2026-11-21'],
  [FRI, '22nd', '2026-11-22'],
  [FRI, '3rd', '2026-12-03'],
  [FRI, '13th', '2026-11-13'],
  [FRI, '31st', '2026-12-31'],
  [SAT31, '31st', '2026-01-31'],
  [SAT31, '30th', '2026-03-30'],
  [SAT31, 'the 1st', '2026-02-01'],
  [LEAP, '29th', '2028-02-29'],
  [LEAP, '30th', '2028-03-30'],

  // numbers: ISO as written, otherwise day first
  [FRI, '2026-12-24', '2026-12-24'],
  [FRI, '2025-01-02', '2025-01-02'],
  [FRI, '24/12', '2026-12-24'],
  [FRI, '24.12', '2026-12-24'],
  [FRI, '24/12/2026', '2026-12-24'],
  [FRI, '24.12.26', '2026-12-24'],
  [FRI, '24.12.2026', '2026-12-24'],
  [FRI, '24/12/2020', '2020-12-24'],
  [FRI, '5/1', '2027-01-05'],
  [FRI, '1/11', '2027-11-01'],
  [FRI, '05.01', '2027-01-05'],
  [SAT31, '29/2', '2028-02-29'],
  [SAT31, '31/1', '2026-01-31'],
  [SAT31, '30/1', '2027-01-30'],
]

// None of these is a date. The day is fixed because none depends on it.
const NOT_DATES = [
  'birthday party',
  'monday.com',
  'satisfied',
  'maybe',
  'march to the store',
  'call 5 people',
  'todayish',
  'tomorrows',
  'sunscreen',
  'money',
  'mayday',
  'wednesdays',
  'pre-monday',
  '#friday',
  'v1.2',
  'yesterday',
  // "sat", "sun" and "tom" alone are ordinary words and a name.
  'sat down with Tom in the sun',
  'tom',
  // days the calendar does not have
  'feb 30',
  '31 april',
  '31st april',
  '31/4',
  '30.02',
  '13/13',
  '2026-13-01',
  '2027-02-29',
  'feb 29 2027',
  '31 april 2027',
  '32nd',
  '0th',
  // numbers that are something else
  'meeting at 10:30',
  'costs 19.99',
  '1.5 kg flour',
  '5.1 surround',
  '1/2/3',
  'the 5',
  'in 3 dayz',
  'in 3',
]

describe('findDate', () => {
  it.each(DATES)('on %s reads "%s" as %s', (today, text, day) => {
    expect(findDate(text, today)).toEqual({ start: 0, end: text.length, day })
  })

  it.each(NOT_DATES)('leaves "%s" as text', (text) => {
    expect(findDate(text, FRI)).toBeNull()
  })

  it('says where in the line the phrase is', () => {
    expect(findDate('call the bank tomorrow about the loan', FRI)).toEqual({ start: 14, end: 22, day: '2026-11-14' })
    expect(findDate('gym next friday', FRI)).toEqual({ start: 4, end: 15, day: '2026-11-20' })
  })

  it('leaves a number after a month and day in the title unless it is a year from 1900 to 2100', () => {
    expect(findDate('jan 5 300 units', FRI)).toEqual({ start: 0, end: 5, day: '2027-01-05' })
    expect(findDate('jan 5 3000 units', FRI)).toEqual({ start: 0, end: 5, day: '2027-01-05' })
    expect(findDate('5 jan 1899', FRI)).toEqual({ start: 0, end: 5, day: '2027-01-05' })
    expect(findDate('order jan 5 2027 units', FRI)).toEqual({ start: 6, end: 16, day: '2027-01-05' })
  })

  it('reads a phrase inside brackets or quotes', () => {
    expect(findDate('call Anna [tomorrow]', FRI)).toEqual({ start: 11, end: 19, day: '2026-11-14' })
    expect(findDate('call Anna "tomorrow"', FRI)).toEqual({ start: 11, end: 19, day: '2026-11-14' })
    expect(findDate("call Anna 'next friday'", FRI)).toEqual({ start: 11, end: 22, day: '2026-11-20' })
    // A possessive is not a date in quotes.
    expect(findDate("today's news", FRI)).toBeNull()
  })

  it('reads any case, and punctuation after the phrase', () => {
    expect(findDate('Call Anna TOMORROW', FRI)?.day).toBe('2026-11-14')
    expect(findDate('today, call Anna', FRI)).toEqual({ start: 0, end: 5, day: FRI })
    expect(findDate('call Anna today.', FRI)).toEqual({ start: 10, end: 15, day: FRI })
    expect(findDate('call Anna (tomorrow)', FRI)).toEqual({ start: 11, end: 19, day: '2026-11-14' })
    expect(findDate('really today?!', FRI)?.day).toBe(FRI)
  })

  it('takes an "on", "by" or "due" in front as part of the phrase', () => {
    expect(findDate('pay rent by friday', FRI)).toEqual({ start: 9, end: 18, day: '2026-11-20' })
    expect(findDate('pay rent due the 5th of january', FRI)).toEqual({ start: 9, end: 31, day: '2027-01-05' })
    expect(findDate('party on 24/12', FRI)).toEqual({ start: 6, end: 14, day: '2026-12-24' })
    // Not in front of a date, so not part of one.
    expect(findDate('stand by the door', FRI)).toBeNull()
  })

  it('takes the last phrase when there are several', () => {
    expect(findDate('plan today for tomorrow', FRI)).toEqual({ start: 15, end: 23, day: '2026-11-14' })
    expect(findDate('move friday standup to 24/12', FRI)?.day).toBe('2026-12-24')
  })

  it('reads the longest phrase, not a date inside it', () => {
    // Not "friday" (20 Nov on a Monday would be 13 Nov) and not "5th".
    expect(findDate('next friday', MON)?.day).toBe('2026-11-20')
    expect(findDate('5th of january', FRI)?.day).toBe('2027-01-05')
    expect(findDate('in 2 weeks', FRI)?.day).toBe('2026-11-27')
  })

  it('does not guess at meaning: a weekday in a name is still a weekday', () => {
    expect(findDate('friday night lights', FRI)).toEqual({ start: 0, end: 6, day: '2026-11-20' })
  })

  it('reads a fraction that is also a day-first date as the date', () => {
    // Known to be ambiguous; Backspace is the way out.
    expect(findDate('3/4 cup of sugar', FRI)?.day).toBe('2027-04-03')
  })
})

describe('dismissing a phrase', () => {
  const text = 'plan today for tomorrow'
  const tomorrow = findDate(text, FRI)
  const gone: Dismissed[] = [{ start: 15, end: 23, words: 'tomorrow' }]

  it('dismisses on Backspace only with the caret right after the phrase and nothing selected', () => {
    expect(dismissOnBackspace(text, 23, 23, tomorrow)).toEqual(gone[0])
    expect(dismissOnBackspace(text, 22, 22, tomorrow)).toBeNull()
    expect(dismissOnBackspace(text, 15, 23, tomorrow)).toBeNull()
    expect(dismissOnBackspace(text, null, null, tomorrow)).toBeNull()
    expect(dismissOnBackspace('plan it', 7, 7, null)).toBeNull()
  })

  it('does not dismiss from behind punctuation', () => {
    const line = 'call Anna today.'
    expect(dismissOnBackspace(line, 16, 16, findDate(line, FRI))).toBeNull()
  })

  it('reads the phrase before it once the last one is dismissed, and nothing once all are', () => {
    expect(findDate(text, FRI, gone)).toEqual({ start: 5, end: 10, day: FRI })
    expect(findDate(text, FRI, [...gone, { start: 5, end: 10, words: 'today' }])).toBeNull()
  })

  it('does not read a shorter date inside a dismissed phrase', () => {
    expect(findDate('gym by next friday', FRI, [{ start: 4, end: 18, words: 'by next friday' }])).toBeNull()
  })

  it('only dismisses the same words at the same place', () => {
    // The same word typed somewhere else is a new phrase.
    expect(findDate('tomorrow plan', FRI, gone)?.day).toBe('2026-11-14')
    expect(findDate('plan today for saturday', FRI, gone)?.day).toBe('2026-11-14')
  })

  it('keeps a dismissal while typing goes on after it', () => {
    expect(carryDismissed(gone, text, text + ' morning')).toEqual(gone)
  })

  it('moves a dismissal along when text is typed or deleted before it', () => {
    expect(carryDismissed(gone, text, 'let us ' + text)).toEqual([{ start: 22, end: 30, words: 'tomorrow' }])
    expect(carryDismissed(gone, text, 'plan for tomorrow')).toEqual([{ start: 9, end: 17, words: 'tomorrow' }])
  })

  it('drops a dismissal when its words are edited, so retyping them is a date again', () => {
    const shorter = 'plan today for tomorro'
    expect(carryDismissed(gone, text, shorter)).toEqual([])
    expect(findDate(text, FRI, carryDismissed([], shorter, text))?.day).toBe('2026-11-14')
    expect(carryDismissed(gone, text, 'plan today for tomXorrow')).toEqual([])
    expect(carryDismissed(gone, text, '')).toEqual([])
  })

  it('reads a dismissed word again once it has grown into a different phrase', () => {
    const fri: Dismissed[] = [{ start: 4, end: 7, words: 'fri' }]
    const kept = carryDismissed(fri, 'gym fri', 'gym friday')
    expect(findDate('gym friday', FRI, kept)).toEqual({ start: 4, end: 10, day: '2026-11-20' })
  })
})
