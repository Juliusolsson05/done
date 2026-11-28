// The Focus screen's task picker: which tasks it offers, in what order, and
// which of them a typed query finds. Plain data in, plain data out.
import { addDays, type Day } from '@/lib/days'
import { fold, matchesQuery } from '@/lib/search'
import { byPriority, openTasks, type Project, type Task } from '@/lib/tasks'
import type { Entry } from '@/lib/time-sheet'

export type GroupKey = 'goal' | 'today' | 'overdue' | 'soon' | 'recent' | 'rest'

export interface PickerGroup {
  // Null for the one flat list of matches: headings would split a short
  // list that is already in the order it should be read.
  key: GroupKey | null
  heading: string | null
  tasks: Task[]
}

const HEADING: Record<GroupKey, string> = {
  goal: 'Today’s goal',
  today: 'Today',
  overdue: 'Overdue',
  soon: 'Soon',
  recent: 'Recent',
  rest: 'Everything else',
}

// "Soon" reaches a week ahead: far enough to see the week's deadlines, near
// enough that the group stays short.
export const SOON_DAYS = 7

const byDue = (a: Task, b: Task) => (a.due ?? '').localeCompare(b.due ?? '') || byPriority(a, b)

// The tasks focused on lately, newest first, each once. Blocks on no task
// and blocks whose task is gone are dropped by the picker, not here.
export function recentTaskIds(entries: Pick<Entry, 'taskId' | 'endedAt'>[]): number[] {
  const ids = [...entries].sort((a, b) => b.endedAt - a.endedAt).flatMap((e) => (e.taskId === null ? [] : [e.taskId]))
  return [...new Set(ids)]
}

// What the task is matched on besides its title: its project's name, so
// "wedding" finds every task in Wedding.
const projectOf = (projects: Project[], task: Task) => projects.find((p) => p.id === task.projectId)?.name ?? 'Inbox'

export interface PickerInput {
  tasks: Task[]
  projects: Project[]
  today: Day
  query: string
  // From recentTaskIds.
  recent: number[]
  // Today's goal, as goalTask finds it (it is one person's on a shared task).
  goalId: number | null
}

// With nothing typed: the groups in the order they matter today, empty ones
// left out. Every open task is in exactly one group. Typed: one list of the
// tasks every word is found in, title matches first, otherwise in the same
// order as the groups.
export function pickerGroups({ tasks, projects, today, query, recent, goalId }: PickerInput): PickerGroup[] {
  // Finished tasks and subtasks are never offered: focus is on a task to do.
  let left = openTasks(tasks)
  const take = (keep: (t: Task) => boolean): Task[] => {
    const taken = left.filter(keep)
    left = left.filter((t) => !keep(t))
    return taken
  }
  const soonEnd = addDays(today, SOON_DAYS)
  const goal = take((t) => t.id === goalId)
  const dueToday = take((t) => t.due === today).sort(byPriority)
  const overdue = take((t) => t.due !== null && t.due < today).sort(byDue)
  const soon = take((t) => t.due !== null && t.due > today && t.due <= soonEnd).sort(byDue)
  const recentRank = new Map(recent.map((id, i) => [id, i]))
  const recently = take((t) => recentRank.has(t.id)).sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0))
  const rest = left.sort(byPriority)

  const groups: PickerGroup[] = (
    [
      ['goal', goal],
      ['today', dueToday],
      ['overdue', overdue],
      ['soon', soon],
      ['recent', recently],
      ['rest', rest],
    ] as const
  )
    .filter(([, list]) => list.length > 0)
    .map(([key, list]) => ({ key, heading: HEADING[key], tasks: [...list] }))

  if (fold(query).trim() === '') return groups

  const ordered = groups.flatMap((g) => g.tasks)
  const found = ordered.filter((t) => matchesQuery(`${t.title}\n${projectOf(projects, t)}`, query))
  // A stable sort keeps the group order among title matches and among the rest.
  const titleFirst = [...found].sort((a, b) => Number(!matchesQuery(a.title, query)) - Number(!matchesQuery(b.title, query)))
  return titleFirst.length ? [{ key: null, heading: null, tasks: titleFirst }] : []
}
