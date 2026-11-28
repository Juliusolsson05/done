// "Hide past tasks" on the Timeline: what is wholly behind today goes, so the
// chart is about what is still ahead. Open tasks always stay, overdue or not;
// a completed task goes when the latest of its start, due and completion days
// is before today. Days are local calendar days (lib/days), compared as text.
import type { Day } from '@/lib/days'
import type { Task } from '@/lib/tasks'
import type { ProjectTimeline } from '@/lib/timeline-projects'

export function isWhollyPast(task: Task, today: Day): boolean {
  if (!task.done || !task.doneDay) return false
  const last = [task.start, task.due, task.doneDay].reduce<Day>((latest, day) => (day && day > latest ? day : latest), task.doneDay)
  return last < today
}

// Nothing is changed: the tasks that stay are the same objects. A subtask
// goes or stays with its task when that task is in the list.
export function hidePast(tasks: Task[], today: Day): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return tasks.filter((task) => {
    const parent = task.parentId != null ? byId.get(task.parentId) : undefined
    return !isWhollyPast(parent ?? task, today)
  })
}

// A project's row goes when nothing of it is left to show: every task it had
// is hidden, or it is a sprint whose deadline has passed. A sprint with a
// deadline ahead, and a project that never had tasks here, stay as before.
export function withoutPastProjects(rows: ProjectTimeline[], shown: Task[], hidden: Task[], today: Day): ProjectTimeline[] {
  const withShown = new Set(shown.map((task) => task.projectId))
  const withHidden = new Set(hidden.map((task) => task.projectId))
  return rows.filter(({ project, deadline }) => {
    if (withShown.has(project.id)) return true
    if (deadline) return deadline >= today
    return !withHidden.has(project.id)
  })
}
