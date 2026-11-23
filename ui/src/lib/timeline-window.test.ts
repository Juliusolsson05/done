import { describe, expect, it } from 'vitest'
import { around, grown, onScreen, reaching, GROW } from '@/lib/timeline-window'

const start = around('2026-11-19')

describe('the timeline as far back and forward as one scrolls', () => {
  it('starts with room to go back at once', () => {
    expect(start).toEqual({ start: '2026-10-29', days: GROW + 35 })
  })

  it('adds three weeks in front near the start, and says how far to move', () => {
    expect(grown(start, 2, 20)).toEqual({ span: { start: '2026-10-08', days: start.days + GROW }, shift: GROW })
    // Again and again: there is no end to it.
    const twice = grown(grown(start, 0, 20).span, 0, 20)
    expect(twice.span.start).toBe('2026-09-17')
  })

  it('adds three weeks after near the end, without moving anything', () => {
    expect(grown(start, start.days - 22, 20)).toEqual({ span: { start: start.start, days: start.days + GROW }, shift: 0 })
  })

  it('leaves it as it is in the middle', () => {
    expect(grown(start, 21, 20)).toEqual({ span: start, shift: 0 })
  })

  it('reaches back to where a task began, with a few days before it', () => {
    const back = reaching(start, '2026-09-01')
    expect(back.shift % GROW).toBe(0)
    expect(back.span.start <= '2026-08-28').toBe(true)
    expect(reaching(start, '2026-11-10')).toEqual({ span: start, shift: 0 })
  })

  it('names the days on screen', () => {
    expect(onScreen(start, 21, 14)).toEqual(['2026-11-19', '2026-12-02'])
    expect(onScreen(start, 20.5, 14)).toEqual(['2026-11-18', '2026-12-02'])
  })
})
