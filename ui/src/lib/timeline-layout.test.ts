import { describe, expect, it } from 'vitest'
import { packLanes, placed, spanOf, type Placed } from '@/lib/timeline-layout'
import type { Task } from '@/lib/tasks'

const task = (id: number, due: string | null, start: string | null = null): Task => ({
  id,
  title: 't' + id,
  notes: '',
  projectId: 1,
  start,
  due,
  priority: 4,
})
const at = (t: Task, labelDays = 1) => placed(t, labelDays) as Placed

describe('laying out a project’s tasks', () => {
  it('makes a one-day task as wide as its label, a range at least its length', () => {
    expect(at(task(1, '2026-11-23'), 4)).toMatchObject({ from: '2026-11-23', to: '2026-11-26' })
    expect(at(task(2, '2026-11-30', '2026-11-23'), 3)).toMatchObject({ from: '2026-11-23', to: '2026-11-30' })
    expect(placed(task(3, null), 2)).toBeNull()
  })

  it('puts tasks that do not overlap on one line, and others below', () => {
    const lanes = packLanes([at(task(1, '2026-11-23'), 3), at(task(2, '2026-11-24'), 3), at(task(3, '2026-11-27'), 2), at(task(4, '2026-11-30'), 1)])
    expect(lanes.map((l) => l.map((p) => p.task.id))).toEqual([[1, 3, 4], [2]])
  })

  it('spans a project from its first start to its last due', () => {
    expect(spanOf([at(task(1, '2026-11-25', '2026-11-20')), at(task(2, '2026-12-03'))])).toEqual({ from: '2026-11-20', to: '2026-12-03' })
    expect(spanOf([])).toBeNull()
  })
})
