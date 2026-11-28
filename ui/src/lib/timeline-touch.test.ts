import { describe, expect, it } from 'vitest'
import { dayWidth, daysToFill, parseZoom, ticks, TOUCH_ZOOMS } from '@/lib/timeline-touch'

// The chart's width at the measured viewports: the screen less the page's
// 16 px gutters on a phone; beside the sidebar and No date on an iPad.
const PHONE = 358 // 390×844
const BIG_PHONE = 408 // 440×956
const PHONE_SIDEWAYS = 812 // 844×390
const IPAD = 756 // 820×1180
const IPAD_SIDEWAYS = 860 // 1180×820

describe('how wide a day is', () => {
  it('fits a whole week on a phone, each day at least a finger wide', () => {
    for (const chart of [PHONE, BIG_PHONE]) {
      const px = dayWidth('week', chart)
      expect(px).toBeGreaterThanOrEqual(44)
      expect(chart / px).toBeGreaterThanOrEqual(7)
    }
    expect(dayWidth('week', PHONE)).toBe(51)
    expect(dayWidth('week', BIG_PHONE)).toBe(58)
  })

  it('gives Day zoom room to read, a few days on a phone', () => {
    expect(dayWidth('day', PHONE)).toBe(71)
    expect(PHONE / dayWidth('day', PHONE)).toBeGreaterThanOrEqual(5)
    expect(dayWidth('day', PHONE_SIDEWAYS)).toBe(112)
  })

  it('never makes a day narrower than 44 px at Day or Week, however small the screen', () => {
    for (const chart of [200, 280, PHONE]) {
      expect(dayWidth('week', chart)).toBeGreaterThanOrEqual(44)
      expect(dayWidth('day', chart)).toBeGreaterThanOrEqual(64)
    }
  })

  it('shows more than one week on an iPad or a phone held sideways', () => {
    for (const chart of [PHONE_SIDEWAYS, IPAD, IPAD_SIDEWAYS]) {
      expect(dayWidth('week', chart)).toBe(72)
      expect(chart / 72).toBeGreaterThan(10)
    }
  })

  it('gets narrower from Day to Quarter at every size', () => {
    for (const chart of [PHONE, BIG_PHONE, PHONE_SIDEWAYS, IPAD, IPAD_SIDEWAYS]) {
      const widths = TOUCH_ZOOMS.map((z) => dayWidth(z, chart))
      expect([...widths].sort((a, b) => b - a)).toEqual(widths)
      expect(new Set(widths).size).toBe(4)
    }
  })

  it('fits about a month at Month and a quarter at Quarter on an iPad', () => {
    expect(IPAD / dayWidth('month', IPAD)).toBeGreaterThanOrEqual(30)
    expect(IPAD / dayWidth('quarter', IPAD)).toBeGreaterThanOrEqual(75)
  })
})

describe('the remembered zoom', () => {
  it('uses this view’s own choice first', () => {
    expect(parseZoom('day', 'quarter')).toBe('day')
    expect(parseZoom('quarter', null)).toBe('quarter')
  })

  it('carries over Month or Quarter chosen before, and starts at Week otherwise', () => {
    expect(parseZoom(null, 'month')).toBe('month')
    expect(parseZoom(null, 'week')).toBe('week')
    expect(parseZoom(null, null)).toBe('week')
    expect(parseZoom('huge', 'nonsense')).toBe('week')
  })
})

describe('the date header', () => {
  it('labels every day when a day has room for a letter and a date', () => {
    expect(ticks(44)).toBe('days')
    expect(ticks(32)).toBe('days')
  })

  it('labels Mondays with the weekday at Month, and only the date at the narrowest', () => {
    expect(ticks(12)).toBe('weeks')
    expect(ticks(8)).toBe('weeks')
    expect(ticks(6)).toBe('dates')
    expect(ticks(4)).toBe('dates')
  })
})

describe('the days drawn', () => {
  it('keeps the span the tasks need when it is wider than the chart', () => {
    expect(daysToFill(60, PHONE, 51)).toBe(60)
  })

  it('reaches the right edge when the chart is wider than the span', () => {
    // Quarter on a phone: 4 px a day, 35 days would be 140 of 358 px.
    expect(daysToFill(35, PHONE, 4)).toBe(90)
  })
})
