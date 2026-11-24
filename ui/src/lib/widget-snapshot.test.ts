import { describe, expect, it } from 'vitest'
import { widgetSnapshot } from '@/lib/widget-snapshot'
import type { Task } from '@/lib/tasks'

const task = (id: number, title: string, due: string | null, extra: Partial<Task> = {}): Task =>
  ({ id, title, notes: '', due, start: null, priority: 4, projectId: null, ...extra }) as Task

// #71: the widget shows what Today shows, in the same order, and the Swift
// side reads seconds.
describe('widgetSnapshot', () => {
  const today = '2026-11-24'
  it('lists the goal, then overdue, then today, and counts them', () => {
    const tasks = [
      task(1, 'Today thing', today),
      task(2, 'Late thing', '2026-11-20'),
      task(3, 'Tomorrow thing', '2026-11-25'),
      task(4, 'The goal', today, { goalDay: today }),
      task(5, 'Done', today, { done: true }),
    ]
    const s = widgetSnapshot(tasks, today, null, null, 1_000_000)
    expect(s.tasks).toEqual([
      { title: 'The goal', mark: 'goal' },
      { title: 'Late thing', mark: 'overdue' },
      { title: 'Today thing', mark: 'today' },
    ])
    expect(s.left).toBe(3)
    expect(s.at).toBe(1000)
  })
  it('gives the focus times in seconds', () => {
    const s = widgetSnapshot([], today, null, { title: 'Write', endsAt: 2_000_000, remaining: null }, 0)
    expect(s.focus).toEqual({ title: 'Write', endsAt: 2000, remaining: null })
  })
})
