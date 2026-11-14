// What a task and a project are, how the views group them, and every change
// the interface makes to them. All of it is plain data in, plain data out;
// nothing here is saved or drawn.
import { addDays, describeDay, fullDay, type Day } from '@/lib/days'

export interface Project {
  id: number
  name: string
  color?: number | null
}

export interface Task {
  id: number
  title: string
  notes: string
  projectId: number | null
  start: Day | null
  due: Day | null
  priority: number
  status?: string | null
  done?: boolean
  doneDay?: Day | null
  goalDay?: Day | null
}

export interface Data {
  rev: number
  nextId: number
  projects: Project[]
  tasks: Task[]
}

export type View =
  | { kind: 'inbox' | 'today' | 'upcoming' | 'timeline' | 'board' | 'focus' | 'settings' }
  | { kind: 'project'; id: number }

export const PRIORITY_NAME: Record<number, string> = { 1: 'Priority 1', 2: 'Priority 2', 3: 'Priority 3', 4: 'No priority' }

export const byPriority = (a: Task, b: Task): number => a.priority - b.priority || a.id - b.id
export const openTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.done)
export const projectName = (projects: Project[], id: number | null): string => projects.find((p) => p.id === id)?.name ?? ''

// Each project has a colour, used wherever its tasks show up. The eight
// colours themselves live in the stylesheet (--project-0 … --project-7); a
// project stores only which one. Tasks with no project (Inbox) are grey.
export const COLOR_COUNT = 8
export function colorIndex(projects: Project[], id: number | null): number | null {
  const index = projects.findIndex((p) => p.id === id)
  return index < 0 ? null : (projects[index].color ?? index) % COLOR_COUNT
}
// A new project takes the first colour no other project is using.
export function nextColor(projects: Project[]): number {
  const used = new Set(projects.map((p) => p.color))
  for (let i = 0; i < COLOR_COUNT; i++) if (!used.has(i)) return i
  return projects.length % COLOR_COUNT
}

// ---------- Views ----------

// Today's goal: one task, named for today.
export const goalTask = (tasks: Task[], today: Day): Task | undefined => tasks.find((t) => t.goalDay === today)

export interface Section {
  heading?: string
  detail?: string
  late?: boolean
  // The "Add task" row sits under this section rather than under the last one.
  addHere?: boolean
  tasks: Task[]
}

export function sections(view: View, all: Task[], today: Day): Section[] {
  const tasks = openTasks(all)
  if (view.kind === 'timeline' || view.kind === 'board' || view.kind === 'focus' || view.kind === 'settings') return []
  if (view.kind === 'inbox') return [{ tasks: tasks.filter((t) => t.projectId === null).sort(byPriority) }]
  if (view.kind === 'project') return [{ tasks: tasks.filter((t) => t.projectId === view.id).sort(byPriority) }]
  if (view.kind === 'today') {
    // The goal is drawn in its own block above, so it is left out of both lists.
    const rest = tasks.filter((t) => t.goalDay !== today)
    const late = rest
      .filter((t) => t.due !== null && t.due < today)
      .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || byPriority(a, b))
    const now = rest.filter((t) => t.due === today).sort(byPriority)
    return late.length
      ? [
          { heading: 'Overdue', late: true, tasks: late },
          { heading: 'Today', tasks: now, addHere: true },
        ]
      : [{ tasks: now }]
  }
  const days = new Map<Day, Task[]>()
  for (const t of tasks) if (t.due && t.due > today) days.set(t.due, [...(days.get(t.due) ?? []), t])
  return [...days.keys()].sort().map((day) => ({
    heading: describeDay(day, today),
    detail: fullDay(day),
    tasks: (days.get(day) ?? []).sort(byPriority),
  }))
}

export interface Counts {
  inbox: number
  today: number
  upcoming: number
  late: boolean
  project: (id: number) => number
}
export function counts(all: Task[], today: Day): Counts {
  const tasks = openTasks(all)
  return {
    inbox: tasks.filter((t) => t.projectId === null).length,
    today: tasks.filter((t) => t.due !== null && t.due <= today).length,
    upcoming: tasks.filter((t) => t.due !== null && t.due > today).length,
    late: tasks.some((t) => t.due !== null && t.due < today),
    project: (id) => tasks.filter((t) => t.projectId === id).length,
  }
}

// Whether finishing this task leaves nothing open for today: it is the only
// open task that is due today or overdue.
export function clearsToday(all: Task[], id: number, today: Day): boolean {
  const due = openTasks(all).filter((t) => t.due !== null && t.due <= today)
  return due.length === 1 && due[0].id === id
}

export type LaneKey = 'todo' | 'doing' | 'done'
export const laneOf = (task: Task): LaneKey => (task.done ? 'done' : task.status === 'doing' ? 'doing' : 'todo')
export function lanes(all: Task[], today: Day): Record<LaneKey, Task[]> {
  const order = (a: Task, b: Task) =>
    (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due ?? '').localeCompare(b.due ?? '') || byPriority(a, b)
  const open = openTasks(all)
  return {
    todo: open.filter((t) => t.status !== 'doing').sort(order),
    doing: open.filter((t) => t.status === 'doing').sort(order),
    // Only today's, so the column is a record of the day and empties overnight.
    done: all.filter((t) => t.done && t.doneDay === today),
  }
}

export interface TimelineGroup {
  id: number | null
  name: string
  tasks: Task[]
}
export function timelineGroups(projects: Project[], all: Task[]): TimelineGroup[] {
  // Dated tasks first, in date order, so each group reads left to right; the
  // undated ones sit underneath, waiting for a click on a day.
  const order = (a: Task, b: Task) =>
    (a.due ? 0 : 1) - (b.due ? 0 : 1) ||
    (a.start ?? a.due ?? '').localeCompare(b.start ?? b.due ?? '') ||
    byPriority(a, b)
  const open = openTasks(all)
  return [{ id: null, name: 'Inbox' }, ...projects]
    .map((g) => ({ id: g.id, name: g.name, tasks: open.filter((t) => t.projectId === g.id).sort(order) }))
    .filter((g) => g.tasks.length > 0)
}

// ---------- Changes ----------
// Each takes the data and returns new data; nothing is changed in place, so
// what was last saved can be compared with what is on screen.

const patch = (data: Data, id: number, change: (t: Task) => Task): Data => ({
  ...data,
  tasks: data.tasks.map((t) => (t.id === id ? change(t) : t)),
})
export const patchTask = (data: Data, id: number, fields: Partial<Task>): Data => patch(data, id, (t) => ({ ...t, ...fields }))

// New ids are taken from nextId here, on the client.
export function addTask(data: Data, fields: Pick<Task, 'title' | 'due' | 'priority' | 'projectId'>): Data {
  const task: Task = { id: data.nextId, title: fields.title, notes: '', start: null, due: fields.due, priority: fields.priority, projectId: fields.projectId }
  return { ...data, nextId: data.nextId + 1, tasks: [...data.tasks, task] }
}

// Naming another task as today's goal moves the title.
export function setGoal(data: Data, id: number, today: Day): Data {
  return {
    ...data,
    tasks: data.tasks.map((t) => {
      // A goal for today with no date would be missing from the timeline.
      if (t.id === id) return { ...t, goalDay: today, due: t.due ?? today }
      return t.goalDay === today ? { ...t, goalDay: null } : t
    }),
  }
}

// Finishing and reopening go through these two, whichever view it happens in.
// doneDay is what puts a task in the board's "Done today" column.
export const markDone = (data: Data, id: number, today: Day): Data =>
  patch(data, id, (t) => (t.done ? t : { ...t, done: true, doneDay: today }))
export const markOpen = (data: Data, id: number): Data =>
  patch(data, id, (t) => (t.done ? { ...t, done: false, doneDay: undefined } : t))

// A task with only a start date is simply due that day; a start on or after
// the due date means a one-day task.
export function tidyDates(start: Day | null, due: Day | null): { start: Day | null; due: Day | null } {
  if (start && !due) return { start: null, due: start }
  if (start && due && start > due) return { start: due, due: start }
  if (start === due) return { start: null, due }
  return { start, due }
}

// Dragging a timeline bar by whole days: the whole bar, or one of its ends.
// The caller keeps an end from being dragged past the other.
export type DragMode = 'move' | 'start' | 'end'
export function dragBar(task: Task, mode: DragMode, days: number): { start: Day | null; due: Day | null } {
  if (!task.due) return { start: task.start, due: task.due }
  const first = task.start ?? task.due
  let start = task.start
  let due = task.due
  if (mode === 'move') {
    start = task.start ? addDays(task.start, days) : null
    due = addDays(task.due, days)
  }
  if (mode === 'end') {
    start = first
    due = addDays(task.due, days)
  }
  if (mode === 'start') start = addDays(first, days)
  return { start: start === due ? null : start, due }
}

export function deleteTask(data: Data, id: number): { data: Data; undo: (d: Data) => Data } {
  const index = data.tasks.findIndex((t) => t.id === id)
  const task = data.tasks[index]
  return {
    data: { ...data, tasks: data.tasks.filter((t) => t.id !== id) },
    undo: (d) => ({ ...d, tasks: d.tasks.toSpliced(index, 0, task) }),
  }
}

export function addProject(data: Data, name: string): Data {
  const project: Project = { id: data.nextId, name, color: nextColor(data.projects) }
  return { ...data, nextId: data.nextId + 1, projects: [...data.projects, project] }
}
export const patchProject = (data: Data, id: number, fields: Partial<Project>): Data => ({
  ...data,
  projects: data.projects.map((p) => (p.id === id ? { ...p, ...fields } : p)),
})

// A project's tasks move to Inbox rather than being deleted with it, and the
// whole thing can be undone, so deleting needs no "are you sure".
export function deleteProject(data: Data, id: number): { data: Data; said: string; undo: (d: Data) => Data } {
  const index = data.projects.findIndex((p) => p.id === id)
  const project = data.projects[index]
  const moved = new Set(data.tasks.filter((t) => t.projectId === id).map((t) => t.id))
  return {
    data: {
      ...data,
      projects: data.projects.filter((p) => p.id !== id),
      tasks: data.tasks.map((t) => (moved.has(t.id) ? { ...t, projectId: null } : t)),
    },
    said: `${project.name} deleted` + (moved.size ? `, ${moved.size} ${moved.size === 1 ? 'task' : 'tasks'} moved to Inbox` : ''),
    undo: (d) => ({
      ...d,
      projects: d.projects.toSpliced(index, 0, project),
      tasks: d.tasks.map((t) => (moved.has(t.id) ? { ...t, projectId: id } : t)),
    }),
  }
}
