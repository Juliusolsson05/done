import { describe, expect, it } from 'vitest'
import { back, opened } from '@/lib/view-history'
import type { View } from '@/lib/tasks'

const today: View = { kind: 'today' }
const lists: View = { kind: 'lists' }
const notes: View = { kind: 'notes' }
const project = (id: number): View => ({ kind: 'project', id })
const always = () => true

describe('view history', () => {
  it('goes back to the tab a list was opened from, not to Lists', () => {
    const history = opened([], today, project(3), false)
    expect(back(history, always)).toEqual({ view: today, history: [] })
  })

  it('walks back one step at a time', () => {
    let history = opened([], lists, notes, false)
    history = opened(history, notes, project(3), false)
    const first = back(history, always)
    expect(first.view).toEqual(notes)
    expect(back(first.history, always).view).toEqual(lists)
  })

  it('starts over at a tab', () => {
    const history = opened([lists, notes], project(3), today, true)
    expect(history).toEqual([])
  })

  it('does not add a step for moving within one kind of view', () => {
    const history = opened([lists], { kind: 'notes', id: 1 }, { kind: 'notes', id: 2 }, false)
    expect(history).toEqual([lists])
  })

  it('skips a list deleted since, and falls back to Lists', () => {
    const exists = (view: View) => !(view.kind === 'project' && view.id === 3)
    expect(back([today, project(3)], exists).view).toEqual(today)
    expect(back([project(3)], exists)).toEqual({ view: lists, history: [] })
    expect(back([], always).view).toEqual(lists)
  })

  it('keeps at most twenty steps', () => {
    let history: View[] = []
    for (let i = 0; i < 30; i++) history = opened(history, i % 2 ? notes : project(i), i % 2 ? project(i) : notes, false)
    expect(history).toHaveLength(20)
  })
})
