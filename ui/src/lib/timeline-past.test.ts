import { describe, expect, it } from 'vitest'
import { addDays, dayOf } from '@/lib/days'
import type { Project, Task } from '@/lib/tasks'
import { hidePast, isWhollyPast, withoutPastProjects } from '@/lib/timeline-past'
import type { ProjectTimeline } from '@/lib/timeline-projects'

const today = '2026-11-27'
const day = (n: number) => addDays(today, n)
const task = (id: number, extra: Partial<Task> = {}): Task => ({
  id,
  title: String(id),
  notes: '',
  projectId: 1,
  start: null,
  due: null,
  priority: 4,
  ...extra,
})
const done = (id: number, doneDay: string, extra: Partial<Task> = {}) => task(id, { done: true, doneDay, ...extra })

describe('isWhollyPast', () => {
  it('never hides an open task, overdue or not', () => {
    expect(isWhollyPast(task(1, { start: day(-9), due: day(-2) }), today)).toBe(false)
    expect(isWhollyPast(task(2, { start: day(-9) }), today)).toBe(false)
    expect(isWhollyPast(task(3, { start: day(-3), due: day(4) }), today)).toBe(false)
    expect(isWhollyPast(task(4), today)).toBe(false)
  })

  it('hides a task completed yesterday that was due yesterday', () => {
    expect(isWhollyPast(done(1, day(-1), { due: day(-1) }), today)).toBe(true)
  })

  it('keeps a task completed early whose due date is still ahead', () => {
    expect(isWhollyPast(done(1, day(-7), { due: day(1) }), today)).toBe(false)
    expect(isWhollyPast(done(2, day(-7), { due: today }), today)).toBe(false)
  })

  it('keeps a task completed today, even when it was due long ago', () => {
    expect(isWhollyPast(done(1, today, { start: day(-30), due: day(-20) }), today)).toBe(false)
  })

  it('keeps a completed task whose range runs past today', () => {
    expect(isWhollyPast(done(1, day(-2), { start: day(-5), due: day(3) }), today)).toBe(false)
  })

  it('judges a completed task with no start or due by its completion day', () => {
    expect(isWhollyPast(done(1, day(-1)), today)).toBe(true)
    expect(isWhollyPast(done(2, today), today)).toBe(false)
  })

  it('compares local calendar days, not times or UTC', () => {
    // The last moment of yesterday and the first of today, in local time.
    const lateYesterday = dayOf(new Date(2026, 10, 26, 23, 59, 59))
    const earlyToday = dayOf(new Date(2026, 10, 27, 0, 0, 1))
    expect(lateYesterday).toBe('2026-11-26')
    expect(earlyToday).toBe(today)
    expect(isWhollyPast(done(1, lateYesterday), today)).toBe(true)
    expect(isWhollyPast(done(2, earlyToday), today)).toBe(false)
    // Across a month and a year boundary.
    expect(isWhollyPast(done(3, '2026-12-31'), '2027-01-01')).toBe(true)
    expect(isWhollyPast(done(4, '2027-01-01'), '2027-01-01')).toBe(false)
  })

  it('treats a completed task without a completion day as not known to be past', () => {
    expect(isWhollyPast(task(1, { done: true, due: day(-5) }), today)).toBe(false)
  })
})

describe('hidePast', () => {
  it('removes only wholly past tasks and changes none', () => {
    const tasks = [task(1, { due: day(-3) }), done(2, day(-10), { due: day(-10) }), done(3, day(-4), { due: day(2) }), done(4, today)]
    const before = JSON.stringify(tasks)
    expect(hidePast(tasks, today).map((t) => t.id)).toEqual([1, 3, 4])
    expect(JSON.stringify(tasks)).toBe(before)
  })

  it('lets subtasks follow their parent', () => {
    const tasks = [
      done(1, day(-10), { due: day(-10) }),
      // Open, but under a hidden task: hidden with it.
      task(2, { parentId: 1 }),
      task(3, { due: day(-2) }),
      // Finished long ago, but under an open task: kept with it.
      done(4, day(-20), { parentId: 3 }),
      // A parent that is not in the list: judged by its own dates.
      done(5, day(-20), { parentId: 99 }),
    ]
    expect(hidePast(tasks, today).map((t) => t.id)).toEqual([3, 4])
  })
})

describe('withoutPastProjects', () => {
  const project = (id: number, deadline: string | null = null): Project => ({
    id,
    name: String(id),
    sprint: deadline ? { enabled: true, deadline, completed: false } : undefined,
  })
  const row = (id: number, deadline: string | null = null): ProjectTimeline => ({
    project: project(id, deadline),
    from: deadline,
    to: deadline,
    deadline,
  })

  it('drops a project whose every task is hidden, and a past sprint with nothing left', () => {
    const rows = [row(1), row(2), row(3, day(-3)), row(4, day(5)), row(5), row(6, day(-3))]
    const shown = [task(10, { projectId: 2, due: day(-1) }), task(11, { projectId: 6, due: day(-1) })]
    const hidden = [done(20, day(-9), { projectId: 1 }), done(21, day(-9), { projectId: 4 })]
    // 1: all hidden. 2: has a task. 3: sprint ended, nothing shown. 4: deadline ahead.
    // 5: never had tasks, kept as before. 6: past deadline but an overdue task is shown.
    expect(withoutPastProjects(rows, shown, hidden, today).map((r) => r.project.id)).toEqual([2, 4, 5, 6])
  })
})
