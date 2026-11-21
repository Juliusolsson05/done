// The Completed page: finished tasks under the day they were finished.
import { describeDay, fullDay, type Day } from '@/lib/days'
import type { Task } from '@/lib/tasks'

export interface DayGroup {
  day: Day
  label: string
  detail: string
  tasks: Task[]
}

// Newest day first; within a day, the order they came in (newest first).
export function byFinishedDay(tasks: Task[], today: Day): DayGroup[] {
  const groups: DayGroup[] = []
  // Sorted by day first (stable, so each day keeps its order), so one day is one group.
  const sorted = [...tasks].sort((a, b) => (b.doneDay ?? '').localeCompare(a.doneDay ?? ''))
  for (const task of sorted) {
    if (!task.doneDay) continue
    const last = groups[groups.length - 1]
    if (last && last.day === task.doneDay) last.tasks.push(task)
    else groups.push({ day: task.doneDay, label: describeDay(task.doneDay, today), detail: fullDay(task.doneDay), tasks: [task] })
  }
  return groups
}
