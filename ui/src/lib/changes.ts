// Working out what to save: only what differs from what the file held when
// this window last loaded or saved.
import type { Data, Project, Task } from '@/lib/tasks'

// One JSON string per project and task, keyed "p<id>" or "t<id>"; and one
// entry per person on a task, keyed "a<task id>|<account id>". Who is on a
// task is kept apart from the task itself so that two people adding someone
// at once both count (they travel one by one, see crates/core Assign).
export type Picture = Map<string, string>

export interface Assign {
  taskId: number
  accountId: string
  on: boolean
}

export interface Change {
  rev: number
  projects: Project[]
  tasks: Task[]
  deleteProjects: number[]
  deleteTasks: number[]
  assign: Assign[]
}

export const picture = (data: Data): Picture =>
  new Map([
    ...data.projects.map((p): [string, string] => ['p' + p.id, JSON.stringify(p)]),
    ...data.tasks.map((t): [string, string] => {
      const { assignees: _, ...task } = t
      return ['t' + t.id, JSON.stringify(task)]
    }),
    ...data.tasks.flatMap((t) => (t.assignees ?? []).map((a): [string, string] => ['a' + t.id + '|' + a, '1'])),
  ])

// Null when nothing differs, so no request is made at all.
export function changeSet(saved: Picture, now: Picture, rev: number): Change | null {
  const change: Change = { rev, projects: [], tasks: [], deleteProjects: [], deleteTasks: [], assign: [] }
  const assignment = (key: string, on: boolean): Assign => {
    const [task, account] = key.slice(1).split('|')
    return { taskId: Number(task), accountId: account, on }
  }
  for (const [key, json] of now) {
    if (saved.get(key) === json) continue
    if (key[0] === 'p') change.projects.push(JSON.parse(json) as Project)
    else if (key[0] === 'a') change.assign.push(assignment(key, true))
    else change.tasks.push(JSON.parse(json) as Task)
  }
  for (const key of saved.keys()) {
    if (now.has(key)) continue
    if (key[0] === 'a') {
      // A deleted task takes its people with it; nobody is taken off it.
      const off = assignment(key, false)
      if (now.has('t' + off.taskId)) change.assign.push(off)
      continue
    }
    const id = Number(key.slice(1))
    if (key[0] === 'p') change.deleteProjects.push(id)
    else change.deleteTasks.push(id)
  }
  const empty = !change.projects.length && !change.tasks.length && !change.deleteProjects.length && !change.deleteTasks.length && !change.assign.length
  return empty ? null : change
}
