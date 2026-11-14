import { describe, expect, it } from 'vitest'
import { parseQuickAdd, readLine } from '@/lib/quick-add'

// 13 November 2026 is a Friday.
const today = '2026-11-13'
const projects = [
  { id: 7, name: 'Home', color: 0 },
  { id: 8, name: 'Side Project', color: 1 },
]
const parse = (text: string) => parseQuickAdd(text, projects, today)

describe('parseQuickAdd', () => {
  it('reads the date, priority and project out of the line', () => {
    expect(parse('call the bank tomorrow p1 #home')).toEqual({ title: 'call the bank', due: '2026-11-14', priority: 1, projectId: 7 })
  })

  it('leaves short words that are ordinary words and names in the title', () => {
    expect(parse('sat down with Tom in the sun')).toEqual({ title: 'sat down with Tom in the sun', due: null, priority: null, projectId: null })
  })

  it('reads the short weekdays that are not ordinary words', () => {
    expect(parse('gym mon').due).toBe('2026-11-16')
    expect(parse('gym thurs').due).toBe('2026-11-19')
  })

  it('takes a weekday named on that weekday to mean next week', () => {
    expect(parse('review friday').due).toBe('2026-11-20')
    expect(parse('review fri').due).toBe('2026-11-20')
  })

  it('drops the "on" or "by" in front of a date, and only there', () => {
    expect(parse('send invoice by Monday')).toMatchObject({ title: 'send invoice', due: '2026-11-16' })
    expect(parse('carry on today')).toMatchObject({ title: 'carry', due: today })
    expect(parse('stand by the door')).toMatchObject({ title: 'stand by the door', due: null })
  })

  it('keeps a second date word, priority or project as part of the title', () => {
    expect(parse('plan today for tomorrow p2 p3')).toEqual({ title: 'plan for tomorrow p3', due: today, priority: 2, projectId: null })
  })

  it('only reads p1 to p4 as a priority', () => {
    expect(parse('buy p5 paper')).toMatchObject({ title: 'buy p5 paper', priority: null })
  })

  it('matches a project by its tag or the start of it, and leaves unknown tags alone', () => {
    expect(parse('ship it #side-project').projectId).toBe(8)
    expect(parse('ship it #side').projectId).toBe(8)
    expect(parse('ship it #work')).toMatchObject({ title: 'ship it #work', projectId: null })
    expect(parse('issue # 4')).toMatchObject({ title: 'issue # 4', projectId: null })
  })
})

describe('readLine', () => {
  it('falls back to the view for what the line does not say', () => {
    const fallback = { due: today, projectId: 8 }
    expect(readLine('water plants', projects, today, fallback)).toEqual({ title: 'water plants', due: today, priority: 4, projectId: 8 })
    expect(readLine('water plants tomorrow #home', projects, today, fallback)).toMatchObject({ due: '2026-11-14', projectId: 7 })
  })
})
