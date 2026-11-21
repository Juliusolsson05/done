import { describe, expect, it } from 'vitest'
import { matchesQuery, searchAll } from '@/lib/search'
import type { Data, Task } from '@/lib/tasks'

const task = (id: number, title: string, more: Partial<Task> = {}): Task => ({
  id,
  title,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  done: false,
  ...more,
})

const data: Data = {
  rev: 1,
  nextId: 10,
  projects: [{ id: 1, name: 'Hop', color: 0 }],
  tasks: [
    task(2, 'Email Rory', { projectId: 1, notes: 'About the seed round deck' }),
    task(3, 'Reply on WhatsApp'),
    task(4, 'Anna', { parentId: 3 }),
    task(5, 'Seed checklist', { done: true, doneDay: '2026-11-21' }),
  ],
}
const notes = [
  { id: 7, text: '# Seed round funds\nAlpha Ventures\nFjörd Fund', updatedAt: 2 },
  { id: 8, text: 'Gift ideas', updatedAt: 1 },
]

describe('matchesQuery', () => {
  it('needs every word, anywhere, ignoring case and accents', () => {
    expect(matchesQuery('Fjörd Fund', 'fund FJORD')).toBe(true)
    expect(matchesQuery('Fjörd Fund', 'fund alpha')).toBe(false)
  })
})

describe('searchAll', () => {
  it('finds nothing for an empty query', () => {
    expect(searchAll(data, notes, '  ')).toEqual([])
  })
  it('finds projects, tasks by their notes and subtasks, and notes, in that order', () => {
    const hits = searchAll(data, notes, 'seed')
    expect(hits.map((h) => [h.kind, h.id])).toEqual([
      ['task', 2],
      ['task', 5],
      ['note', 7],
    ])
    // The open task comes before the finished one, and says why it matched.
    expect(hits[0].detail).toBe('Hop · About the seed round deck')
    expect(hits[2].title).toBe('Seed round funds')
  })
  it('finds a subtask by its title before the task found through it, and says what it is under', () => {
    const hits = searchAll(data, notes, 'anna')
    expect(hits.map((h) => [h.kind, h.id, h.detail])).toEqual([
      ['task', 4, 'in Reply on WhatsApp'],
      ['task', 3, 'Inbox · Anna'],
    ])
  })
  it('shows the note line that matched', () => {
    expect(searchAll(data, notes, 'alpha')[0].detail).toBe('Alpha Ventures')
  })
  it('lists projects first', () => {
    expect(searchAll(data, notes, 'hop')[0]).toMatchObject({ kind: 'project', id: 1 })
  })
})
