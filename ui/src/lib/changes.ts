// Working out what to save: only what differs from what the file held when
// this window last loaded or saved.
import type { Data, Project, Task } from '@/lib/tasks'

// One JSON string per project and task, keyed "p<id>" or "t<id>".
export type Picture = Map<string, string>

export interface Change {
  rev: number
  projects: Project[]
  tasks: Task[]
  deleteProjects: number[]
  deleteTasks: number[]
}

export const picture = (data: Data): Picture =>
  new Map([
    ...data.projects.map((p): [string, string] => ['p' + p.id, JSON.stringify(p)]),
    ...data.tasks.map((t): [string, string] => ['t' + t.id, JSON.stringify(t)]),
  ])

// Null when nothing differs, so no request is made at all.
export function changeSet(saved: Picture, now: Picture, rev: number): Change | null {
  const change: Change = { rev, projects: [], tasks: [], deleteProjects: [], deleteTasks: [] }
  for (const [key, json] of now) {
    if (saved.get(key) === json) continue
    if (key[0] === 'p') change.projects.push(JSON.parse(json) as Project)
    else change.tasks.push(JSON.parse(json) as Task)
  }
  for (const key of saved.keys()) {
    if (now.has(key)) continue
    const id = Number(key.slice(1))
    if (key[0] === 'p') change.deleteProjects.push(id)
    else change.deleteTasks.push(id)
  }
  const empty = !change.projects.length && !change.tasks.length && !change.deleteProjects.length && !change.deleteTasks.length
  return empty ? null : change
}
