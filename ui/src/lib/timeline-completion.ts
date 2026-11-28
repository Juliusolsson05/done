import { addDays, type Day } from '@/lib/days'
import { isSubtask, type Task } from '@/lib/tasks'
import type { Placed } from '@/lib/timeline-layout'
import type { Span } from '@/lib/timeline-window'

export function completionDates(tasks: Task[], today: Day): { start: null; due: Day }[] {
  const recent = addDays(today, -30)
  return tasks.flatMap(({ doneDay }) => doneDay && doneDay >= recent && doneDay <= today ? [{ start: null, due: doneDay }] : [])
}

export function completedItems(tasks: Task[], span: Span): Placed[] {
  const last = addDays(span.start, span.days - 1)
  return tasks.flatMap((task) => {
    if (!task.done || !task.doneDay || isSubtask(task)) return []
    const dates = [task.start, task.due, task.doneDay].filter((day): day is Day => !!day).sort()
    const from = dates[0]
    const to = dates[dates.length - 1]
    return from <= last && to >= span.start ? [{ task, from, to }] : []
  })
}

export function completedByProject(items: Placed[]): Map<number | null, Placed[]> {
  const groups = new Map<number | null, Placed[]>()
  for (const item of items) {
    const key = item.task.projectId
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}
