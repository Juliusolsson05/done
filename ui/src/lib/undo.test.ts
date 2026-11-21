import { beforeEach, describe, expect, it } from 'vitest'
import type { Data, Task } from '@/lib/tasks'
import { canUndo, recordChange, recordStep, revert, undoLast } from '@/lib/undo'

const task = (id: number, title: string, more: Partial<Task> = {}): Task => ({
  id,
  title,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...more,
})
const data = (tasks: Task[]): Data => ({ rev: 1, nextId: 9, projects: [{ id: 1, name: 'Hop', color: 0 }], tasks })

beforeEach(() => {
  while (canUndo()) undoLast()
})

describe('revert', () => {
  it('puts back a changed task, brings back a removed one and removes an added one', () => {
    const before = data([task(2, 'Email Rory'), task(3, 'Call bank')])
    const after = data([task(2, 'Email Rory', { priority: 1 }), task(4, 'New')])
    const back = revert(before, after, after)
    expect(back.tasks.map((t) => [t.id, t.priority]).sort()).toEqual([
      [2, 4],
      [3, 4],
    ])
  })
  it('leaves alone what someone else changed in the meantime', () => {
    const before = data([task(2, 'Email Rory'), task(5, 'Agent task')])
    const after = data([task(2, 'Email Rory', { done: true, doneDay: '2026-11-21' }), task(5, 'Agent task')])
    // An agent renamed task 5 after this window's change.
    const now = data([task(2, 'Email Rory', { done: true, doneDay: '2026-11-21' }), task(5, 'Agent task, renamed')])
    const back = revert(before, after, now)
    expect(back.tasks.find((t) => t.id === 2)?.done).toBeUndefined()
    expect(back.tasks.find((t) => t.id === 5)?.title).toBe('Agent task, renamed')
  })
})

describe('the undo steps', () => {
  it('undoes the last change, and changes close together as one', () => {
    let current = data([task(2, 'A')])
    const apply = (fn: (d: Data) => Data) => {
      current = fn(current)
    }
    const step = (fn: (d: Data) => Data, at: number) => {
      const before = current
      current = fn(current)
      recordChange(before, current, apply, at)
    }
    step((d) => ({ ...d, tasks: [task(2, 'B')] }), 0)
    // A drag: two changes within a second are one step.
    step((d) => ({ ...d, tasks: [task(2, 'B', { due: '2026-11-22' })] }), 5000)
    step((d) => ({ ...d, tasks: [task(2, 'B', { due: '2026-11-23' })] }), 5400)
    expect(undoLast()).toBe(true)
    expect(current.tasks[0]).toEqual(task(2, 'B'))
    expect(undoLast()).toBe(true)
    expect(current.tasks[0].title).toBe('A')
    expect(undoLast()).toBe(false)
  })
  it('undoes other kinds of steps too', () => {
    let undone = false
    recordStep(() => (undone = true))
    expect(undoLast()).toBe(true)
    expect(undone).toBe(true)
  })
})
