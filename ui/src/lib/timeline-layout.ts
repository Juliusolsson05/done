// How the Timeline lays out a project's tasks: as few lines as fit them.
// Each task takes the days from its start to its due date, or, when its
// label is wider than that at the zoom in use, as many days as the label
// needs; tasks that do not overlap share a line. Plain data in, plain data out.
import { addDays, daysBetween, type Day } from '@/lib/days'
import type { Task } from '@/lib/tasks'

// Pixels per day at each zoom.
export type Zoom = 'week' | 'month' | 'quarter'
export const DAY_PX: Record<Zoom, number> = { week: 40, month: 18, quarter: 6 }

export interface Placed {
  task: Task
  // First and last day it covers on the chart (its label included).
  from: Day
  to: Day
}

// The days a task covers on the chart. `labelDays`: how many days its label
// needs at this zoom; a one-day task is as wide as its label.
export function placed(task: Task, labelDays: number): Placed | null {
  const first = task.start ?? task.due
  const last = task.due ?? task.start
  if (!first || !last) return null
  const length = daysBetween(first, last) + 1
  return { task, from: first, to: addDays(first, Math.max(length, labelDays) - 1) }
}

// Lines of tasks that do not overlap, earliest first, each task in the first
// line it fits, with a day of air between neighbours.
export function packLanes(items: Placed[]): Placed[][] {
  const lanes: Placed[][] = []
  const sorted = [...items].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.task.id - b.task.id)
  for (const item of sorted) {
    const lane = lanes.find((l) => l[l.length - 1].to < item.from)
    if (lane) lane.push(item)
    else lanes.push([item])
  }
  return lanes
}

// A project's bar: from its first task's start to its last task's due.
export function spanOf(items: Placed[]): { from: Day; to: Day } | null {
  if (!items.length) return null
  let from = items[0].task.start ?? items[0].task.due!
  let to = items[0].task.due ?? from
  for (const { task } of items) {
    const a = task.start ?? task.due
    const b = task.due ?? task.start
    if (a && a < from) from = a
    if (b && b > to) to = b
  }
  return { from, to }
}
