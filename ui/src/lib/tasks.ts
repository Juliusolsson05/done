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
  // Set on a subtask: the task it is listed under. One level only.
  parentId?: number | null
}

export interface Data {
  rev: number
  nextId: number
  projects: Project[]
  tasks: Task[]
}

export type View =
  | { kind: 'inbox' | 'today' | 'upcoming' | 'timeline' | 'board' | 'focus' | 'timesheet' | 'completed' | 'settings' }
  // A phone's home for everything that is not one of its three tabs, in
  // place of the sidebar.
  | { kind: 'lists' }
  // A note id opens that note.
  | { kind: 'notes'; id?: number }
  | { kind: 'project'; id: number }

export const PRIORITY_NAME: Record<number, string> = { 1: 'Priority 1', 2: 'Priority 2', 3: 'Priority 3', 4: 'No priority' }

export const byPriority = (a: Task, b: Task): number => a.priority - b.priority || a.id - b.id
// Subtasks are left out here, and every list, count, board column, timeline
// row and focus picker is built from this: a subtask is only ever shown under
// its task, so it must not also turn up on its own anywhere.
export const isSubtask = (task: Task): boolean => task.parentId != null
export const openTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.done && !isSubtask(t))

// A task's subtasks, in the order they were added, done ones included: a
// list being ticked off keeps showing what was ticked.
export const subtasksOf = (tasks: Task[], id: number): Task[] => tasks.filter((t) => t.parentId === id).sort((a, b) => a.id - b.id)
// Null for a task with no subtasks, so a row can tell "none" from "0 of 3".
export function progress(tasks: Task[], id: number): { done: number; total: number } | null {
  const under = tasks.filter((t) => t.parentId === id)
  return under.length ? { done: under.filter((t) => t.done).length, total: under.length } : null
}
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
  if (view.kind === 'timeline' || view.kind === 'board' || view.kind === 'focus' || view.kind === 'timesheet' || view.kind === 'completed' || view.kind === 'notes' || view.kind === 'settings' || view.kind === 'lists') return []
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

// Whether finishing this task earns the fuller sound: it is today's goal,
// it leaves the list being looked at empty (Today, Inbox, a project), it is
// the last open subtask of its task, or it is a round 5th thing done today.
export function finishesBig(all: Task[], id: number, view: View, today: Day): boolean {
  const task = all.find((t) => t.id === id)
  if (!task || task.done) return false
  if (task.goalDay === today) return true
  if (task.parentId != null) return all.filter((t) => t.parentId === task.parentId && !t.done).length === 1
  if (view.kind === 'today' && clearsToday(all, id, today)) return true
  const listed = view.kind === 'inbox' || view.kind === 'project' ? sections(view, all, today).flatMap((s) => s.tasks) : []
  if (listed.length === 1 && listed[0].id === id) return true
  const doneToday = all.filter((t) => t.done && t.doneDay === today && t.parentId == null).length
  return (doneToday + 1) % 5 === 0
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
    done: all.filter((t) => t.done && t.doneDay === today && !isSubtask(t)),
  }
}

// How the Timeline lists its rows: by project, then date inside each (the
// default); or by date across every project, then project for a tie.
export type TimelineOrder = 'project' | 'date'

export interface TimelineGroup {
  key: string
  // The project the group is, for its dot: null is the Inbox. Undefined for
  // a group that is not a project ("Scheduled", "No date").
  id?: number | null
  name: string
  tasks: Task[]
}

const firstDay = (t: Task): string => t.start ?? t.due ?? ''

export function timelineGroups(projects: Project[], all: Task[], order: TimelineOrder = 'project'): TimelineGroup[] {
  const open = openTasks(all)
  const groups: TimelineGroup[] =
    order === 'project'
      ? [{ id: null, name: 'Inbox' }, ...projects].map((g) => ({
          key: 'p' + (g.id ?? 'inbox'),
          id: g.id,
          name: g.name,
          // Dated tasks first, in date order, so each group reads left to
          // right; the undated ones sit underneath, waiting for a click on a day.
          tasks: open
            .filter((t) => t.projectId === g.id)
            .sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || firstDay(a).localeCompare(firstDay(b)) || byPriority(a, b)),
        }))
      : (() => {
          // A tie on the day goes to the project, in the sidebar's order with
          // the Inbox first, so one project's tasks on a day stay together.
          const place = (t: Task) => (t.projectId === null ? -1 : projects.findIndex((p) => p.id === t.projectId))
          const byDate = (a: Task, b: Task) => firstDay(a).localeCompare(firstDay(b)) || place(a) - place(b) || byPriority(a, b)
          const byProject = (a: Task, b: Task) => place(a) - place(b) || byPriority(a, b)
          return [
            { key: 'dated', name: 'Scheduled', tasks: open.filter((t) => t.due).sort(byDate) },
            { key: 'undated', name: 'No date', tasks: open.filter((t) => !t.due).sort(byProject) },
          ]
        })()
  return groups.filter((g) => g.tasks.length > 0)
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

// A subtask starts in its task's project. Nothing reads a subtask's project
// afterwards (it is only ever shown under its task), so moving the task does
// not need to move them.
export function addSubtask(data: Data, parentId: number, title: string): Data {
  const parent = data.tasks.find((t) => t.id === parentId)
  // One level only: nothing is added under a subtask or a task that is gone.
  if (!parent || isSubtask(parent)) return data
  const task: Task = { id: data.nextId, title, notes: '', start: null, due: null, priority: 4, projectId: parent.projectId, parentId }
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
// A finished task has nothing left open under it, so its open subtasks are
// finished with it. Reopening (Undo) brings back the ones finished on the
// same day as the task, which are the ones it took with it; a subtask ticked
// on an earlier day was ticked by hand and stays ticked.
export function markDone(data: Data, id: number, today: Day): Data {
  const finish = (t: Task): Task => (t.done ? t : { ...t, done: true, doneDay: today })
  return { ...data, tasks: data.tasks.map((t) => (t.id === id || t.parentId === id ? finish(t) : t)) }
}
export function markOpen(data: Data, id: number): Data {
  const task = data.tasks.find((t) => t.id === id)
  if (!task?.done) return data
  const reopen = (t: Task): Task => ({ ...t, done: false, doneDay: undefined })
  return {
    ...data,
    tasks: data.tasks.map((t) => (t.id === id || (t.parentId === id && t.done && t.doneDay === task.doneDay) ? reopen(t) : t)),
  }
}

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

// A task goes with its subtasks: the file deletes them with it, so the
// window must too, or it would keep showing rows that no longer exist.
export function deleteTask(data: Data, id: number): { data: Data; undo: (d: Data) => Data } {
  const gone = (t: Task) => t.id === id || t.parentId === id
  // Where each one was, lowest first, so putting them back one at a time
  // lands every one at its old position.
  const removed = data.tasks.flatMap((task, index) => (gone(task) ? [{ task, index }] : []))
  return {
    data: { ...data, tasks: data.tasks.filter((t) => !gone(t)) },
    undo: (d) => ({ ...d, tasks: removed.reduce((tasks, { task, index }) => tasks.toSpliced(index, 0, task), d.tasks) }),
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
