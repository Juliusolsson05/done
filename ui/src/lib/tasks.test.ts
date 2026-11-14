import { describe, expect, it } from 'vitest'
import {
  addProject,
  counts,
  deleteProject,
  deleteTask,
  dragBar,
  lanes,
  markDone,
  markOpen,
  nextColor,
  sections,
  setGoal,
  tidyDates,
  timelineGroups,
  type Data,
  type Task,
} from '@/lib/tasks'

const today = '2026-11-13'
const task = (id: number, fields: Partial<Task> = {}): Task => ({
  id,
  title: 'Task ' + id,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...fields,
})
const data = (tasks: Task[], projects: Data['projects'] = []): Data => ({ rev: 1, nextId: 100, projects, tasks })
const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('sections', () => {
  it('keeps overdue apart from today, oldest first, and adds under Today', () => {
    const list = sections(
      { kind: 'today' },
      [task(1, { due: today }), task(2, { due: '2026-11-12' }), task(3, { due: '2026-11-01' }), task(4, { due: '2026-11-14' }), task(5)],
      today,
    )
    expect(list.map((s) => s.heading)).toEqual(['Overdue', 'Today'])
    expect(ids(list[0].tasks)).toEqual([3, 2])
    expect(ids(list[1].tasks)).toEqual([1])
    expect(list[1].addHere).toBe(true)
  })

  it('shows today as one list with no headings when nothing is overdue', () => {
    const list = sections({ kind: 'today' }, [task(1, { due: today, priority: 3 }), task(2, { due: today, priority: 1 })], today)
    expect(list).toHaveLength(1)
    expect(list[0].heading).toBeUndefined()
    expect(ids(list[0].tasks)).toEqual([2, 1])
  })

  it("leaves today's goal out of the lists, because it has its own block", () => {
    const list = sections({ kind: 'today' }, [task(1, { due: today, goalDay: today }), task(2, { due: today })], today)
    expect(ids(list[0].tasks)).toEqual([2])
  })

  it('groups upcoming by day in date order and leaves out today, overdue, undated and finished', () => {
    const list = sections(
      { kind: 'upcoming' },
      [
        task(1, { due: '2026-11-20' }),
        task(2, { due: '2026-11-14', priority: 2 }),
        task(3, { due: '2026-11-14', priority: 1 }),
        task(4, { due: today }),
        task(5, { due: '2026-11-12' }),
        task(6),
        task(7, { due: '2026-11-15', done: true }),
      ],
      today,
    )
    expect(list.map((s) => s.heading)).toEqual(['Tomorrow', '20 Nov'])
    expect(ids(list[0].tasks)).toEqual([3, 2])
  })

  it('puts only tasks without a project in the inbox', () => {
    const all = [task(1), task(2, { projectId: 9 }), task(3, { done: true })]
    expect(ids(sections({ kind: 'inbox' }, all, today)[0].tasks)).toEqual([1])
    expect(ids(sections({ kind: 'project', id: 9 }, all, today)[0].tasks)).toEqual([2])
  })
})

describe('counts', () => {
  it('counts overdue in Today and flags it', () => {
    const c = counts([task(1, { due: today }), task(2, { due: '2026-11-10' }), task(3, { due: '2026-11-14' }), task(4, { due: today, done: true })], today)
    expect(c.today).toBe(2)
    expect(c.upcoming).toBe(1)
    expect(c.late).toBe(true)
  })
})

describe('lanes', () => {
  it('shows only what was finished today in Done', () => {
    const l = lanes(
      [task(1), task(2, { status: 'doing' }), task(3, { done: true, doneDay: today }), task(4, { done: true, doneDay: '2026-11-12' })],
      today,
    )
    expect(ids(l.todo)).toEqual([1])
    expect(ids(l.doing)).toEqual([2])
    expect(ids(l.done)).toEqual([3])
  })
})

describe('timelineGroups', () => {
  it('lists Inbox first, skips empty projects and puts undated tasks last', () => {
    const groups = timelineGroups(
      [
        { id: 8, name: 'Empty' },
        { id: 9, name: 'Home' },
      ],
      [task(1), task(2, { due: '2026-11-20' }), task(3, { start: '2026-11-10', due: '2026-11-25' }), task(4, { projectId: 9 })],
    )
    expect(groups.map((g) => g.name)).toEqual(['Inbox', 'Home'])
    expect(ids(groups[0].tasks)).toEqual([3, 2, 1])
  })
})

describe("today's goal", () => {
  it('moves the title from the old goal and gives an undated goal a date', () => {
    const next = setGoal(data([task(1, { goalDay: today, due: today }), task(2), task(3, { goalDay: '2026-11-12' })]), 2, today)
    expect(next.tasks[0].goalDay).toBeNull()
    expect(next.tasks[1]).toMatchObject({ goalDay: today, due: today })
    // Yesterday's goal is history, not a second goal for today.
    expect(next.tasks[2].goalDay).toBe('2026-11-12')
  })

  it('keeps the date a goal already has', () => {
    expect(setGoal(data([task(1, { due: '2026-11-20' })]), 1, today).tasks[0].due).toBe('2026-11-20')
  })
})

describe('finishing', () => {
  it('records the day a task was finished and forgets it on reopening', () => {
    const done = markDone(data([task(1)]), 1, today)
    expect(done.tasks[0]).toMatchObject({ done: true, doneDay: today })
    const reopened = markOpen(done, 1)
    expect(reopened.tasks[0].done).toBe(false)
    // Absent rather than null, so it is left out of what is sent.
    expect(JSON.parse(JSON.stringify(reopened.tasks[0]))).not.toHaveProperty('doneDay')
  })

  it('does not move the day of a task that was already finished', () => {
    const before = data([task(1, { done: true, doneDay: '2026-11-10' })])
    expect(markDone(before, 1, today).tasks[0].doneDay).toBe('2026-11-10')
  })
})

describe('tidyDates', () => {
  it('turns a lone start into the due day', () => {
    expect(tidyDates('2026-11-14', null)).toEqual({ start: null, due: '2026-11-14' })
  })
  it('swaps a start that is after the due day', () => {
    expect(tidyDates('2026-11-20', '2026-11-14')).toEqual({ start: '2026-11-14', due: '2026-11-20' })
  })
  it('drops a start on the due day', () => {
    expect(tidyDates('2026-11-14', '2026-11-14')).toEqual({ start: null, due: '2026-11-14' })
  })
})

describe('dragBar', () => {
  const span = task(1, { start: '2026-11-10', due: '2026-11-14' })
  const single = task(2, { due: '2026-11-14' })

  it('moves both ends together and keeps a one-day task one day', () => {
    expect(dragBar(span, 'move', 3)).toEqual({ start: '2026-11-13', due: '2026-11-17' })
    expect(dragBar(single, 'move', -2)).toEqual({ start: null, due: '2026-11-12' })
  })
  it('stretches a one-day task from either end', () => {
    expect(dragBar(single, 'end', 2)).toEqual({ start: '2026-11-14', due: '2026-11-16' })
    expect(dragBar(single, 'start', -2)).toEqual({ start: '2026-11-12', due: '2026-11-14' })
  })
  it('drops the start when an end is dragged back onto the other', () => {
    expect(dragBar(span, 'end', -4)).toEqual({ start: null, due: '2026-11-10' })
    expect(dragBar(span, 'start', 4)).toEqual({ start: null, due: '2026-11-14' })
  })
})

describe('deleting', () => {
  it('puts a deleted task back where it was', () => {
    const before = data([task(1), task(2), task(3)])
    const { data: after, undo } = deleteTask(before, 2)
    expect(ids(after.tasks)).toEqual([1, 3])
    expect(undo(after)).toEqual(before)
  })

  it("moves a deleted project's tasks to Inbox, says how many, and undoes both", () => {
    const before = data(
      [task(1, { projectId: 9 }), task(2, { projectId: 9 }), task(3, { projectId: 8 })],
      [
        { id: 8, name: 'Work', color: 0 },
        { id: 9, name: 'Home', color: 1 },
      ],
    )
    const { data: after, said, undo } = deleteProject(before, 9)
    expect(after.projects.map((p) => p.id)).toEqual([8])
    expect(after.tasks.map((t) => t.projectId)).toEqual([null, null, 8])
    expect(said).toBe('Home deleted, 2 tasks moved to Inbox')
    expect(undo(after)).toEqual(before)
  })
})

describe('new projects', () => {
  it('takes the first colour nobody is using, and its id from nextId', () => {
    const next = addProject(data([], [{ id: 1, name: 'A', color: 0 }, { id: 2, name: 'B', color: 2 }]), 'C')
    expect(next.projects.at(-1)).toEqual({ id: 100, name: 'C', color: 1 })
    expect(next.nextId).toBe(101)
  })
  it('starts again once all eight colours are taken', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: 'P', color: i }))
    expect(nextColor(eight)).toBe(0)
  })
})
