import { daysBetween, type Day } from '@/lib/days'
import { openTasks, type Project, type Task } from '@/lib/tasks'
import { isFiltering, type ViewFilter } from '@/lib/view-filter'

export interface ProjectTimeline {
  project: Project
  from: Day | null
  to: Day | null
  deadline: Day | null
}

export function projectTimelines(projects: Project[], visibleTasks: Task[], filter: ViewFilter): ProjectTimeline[] {
  const rows = new Map<number, ProjectTimeline>()
  const hasTaskFilter = isFiltering({ ...filter, projects: [] })
  const matchingProjects = new Set(visibleTasks.map((task) => task.projectId))
  for (const project of projects) {
    if (filter.projects.length && !filter.projects.includes(project.id)) continue
    if (hasTaskFilter && !matchingProjects.has(project.id)) continue
    const deadline = project.sprint?.enabled ? project.sprint.deadline : null
    rows.set(project.id, { project, from: deadline, to: deadline, deadline })
  }

  for (const task of openTasks(visibleTasks)) {
    if (task.projectId === null) continue
    const row = rows.get(task.projectId)
    if (!row) continue
    const first = task.start ?? task.due
    const last = task.due ?? task.start
    if (first && (!row.from || first < row.from)) row.from = first
    if (last && (!row.to || last > row.to)) row.to = last
  }
  return [...rows.values()].filter(({ project, from }) => project.sprint?.enabled || from !== null)
}

// A sprint deadline can extend the chart, but a distant date on its own
// shouldn't create thousands of daily columns. Its label still shows the date.
export function timelineProjectDates(rows: ProjectTimeline[], today: Day): { due: Day }[] {
  return rows.flatMap(({ deadline }) => deadline && Math.abs(daysBetween(today, deadline)) <= 730 ? [{ due: deadline }] : [])
}
