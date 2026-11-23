// Workspaces, as the window sees them: the spaces the server says this
// person is in, who is in each, and the notifications. Plain data in, plain
// data out. Which space a row is in is the server's word (crates/server/src/pg.rs);
// here it is only read, to choose what each view shows.
import type { Data, Project, Task } from '@/lib/tasks'

export interface Member {
  id: string
  name: string
  email: string
  picture: string
  role: 'owner' | 'member'
}

export interface Invite {
  id: number
  email: string
  created: number
  expires: number
}

export interface Space {
  id: number
  kind: 'personal' | 'workspace'
  name: string
  owner: string
  role: 'owner' | 'member'
  members: Member[]
  invites: Invite[]
}

export interface Person {
  id: string | null
  name: string | null
  picture: string | null
}

export interface Notice {
  id: string
  kind: 'invite' | 'assigned' | 'joined'
  read: boolean
  created: number
  by: Person
  spaceName?: string | null
  // An invite: its id, and how many are in the workspace already.
  invite?: number
  members?: number
  // Being assigned: the task, where it is.
  task?: number | null
  taskTitle?: string | null
  projectId?: number | null
  space?: number | null
}

export interface Team {
  me: string
  personal: number
  spaces: Space[]
  notifications: Notice[]
}

// Where the picker is: everything, your own space, or one workspace.
export type Scope = 'all' | 'personal' | number

export const workspaces = (team: Team | null | undefined): Space[] => (team?.spaces ?? []).filter((s) => s.kind === 'workspace')

// A row with no space is one a device made before it ever synced: its own.
export const isPersonal = (spaceId: number | null | undefined, team: Team | null | undefined): boolean =>
  spaceId == null || !team || spaceId === team.personal || !workspaces(team).some((s) => s.id === spaceId)

export const workspaceOf = (spaceId: number | null | undefined, team: Team | null | undefined): Space | undefined =>
  spaceId == null ? undefined : workspaces(team).find((s) => s.id === spaceId)

// A task is where its project is; a subtask where its task is. The server
// says the same, and also says so in spaceId once it has seen the task, but a
// task just moved here has not been seen yet.
export function spaceOfTask(task: Task, data: Pick<Data, 'projects' | 'tasks'>): number | null {
  const parent = task.parentId != null ? data.tasks.find((t) => t.id === task.parentId) : undefined
  if (parent) return spaceOfTask(parent, data)
  const project = task.projectId != null ? data.projects.find((p) => p.id === task.projectId) : undefined
  if (project) return project.spaceId ?? null
  return task.spaceId ?? null
}

export function inScope(spaceId: number | null | undefined, scope: Scope, team: Team | null | undefined): boolean {
  if (scope === 'all') return true
  if (scope === 'personal') return isPersonal(spaceId, team)
  return spaceId === scope
}

// A scope that no longer exists (a workspace left, or deleted) is All.
export function validScope(scope: Scope, team: Team | null | undefined): Scope {
  if (scope === 'all' || scope === 'personal') return workspaces(team).length ? scope : 'all'
  return workspaces(team).some((s) => s.id === scope) ? scope : 'all'
}

export interface Shown {
  projects: Project[]
  tasks: Task[]
}

// What every view lists for the scope. Data itself is never cut down: it is
// what is saved, and a change made through a view applies to all of it.
export function shownFor(data: Pick<Data, 'projects' | 'tasks'>, scope: Scope, team: Team | null | undefined): Shown {
  if (scope === 'all') return { projects: data.projects, tasks: data.tasks }
  return {
    projects: data.projects.filter((p) => inScope(p.spaceId, scope, team)),
    tasks: data.tasks.filter((t) => inScope(spaceOfTask(t, data), scope, team)),
  }
}

// In All, Today and Upcoming leave out a workspace task that is someone
// else's: assigned to others and not to you. Yours and nobody's stay.
export function forMe(task: Task, me: string | null | undefined): boolean {
  const on = task.assignees ?? []
  return !me || on.length === 0 || on.includes(me)
}

export const member = (team: Team | null | undefined, spaceId: number | null | undefined, id: string): Member | undefined =>
  workspaceOf(spaceId, team)?.members.find((m) => m.id === id) ?? team?.spaces.flatMap((s) => s.members).find((m) => m.id === id)

// Two letters at most, from the name, or the address before there is one.
export function initials(name: string | null | undefined, email = ''): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length) return words.length === 1 ? words[0].slice(0, 1).toUpperCase() : (words[0][0] + words[words.length - 1][0]).toUpperCase()
  return (email[0] ?? '•').toUpperCase()
}

// A colour of its own for each person without a picture, the same every time.
const TINTS = ['#1e4fbf', '#2f9a5c', '#cf4d7c', '#b08d16', '#7c63d6', '#2495a3', '#d27a2c', '#74747d']
export function tintOf(id: string | null | undefined): string {
  let h = 0
  for (const c of id ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}

export const unread = (team: Team | null | undefined): number => (team?.notifications ?? []).filter((n) => !n.read).length

// "Julius", or "Julius and Geart", or "Julius, Geart and Ana".
export function namesOf(people: string[]): string {
  if (people.length <= 1) return people[0] ?? ''
  return people.slice(0, -1).join(', ') + ' and ' + people[people.length - 1]
}

export const firstName = (name: string | null | undefined): string => (name ?? '').trim().split(/\s+/)[0] ?? ''

// The tag typed in quick add for a member: their first name, lower case,
// letters and digits only ("+geart").
export const handleOf = (m: Pick<Member, 'name' | 'email'>): string =>
  (firstName(m.name) || m.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]/g, '')

// The project a task added in a workspace goes into when none is named:
// the Inbox is one's own, so the workspace's first project.
export function defaultProjectFor(scope: Scope, projects: Project[]): number | null {
  if (typeof scope !== 'number') return null
  return projects.find((p) => p.spaceId === scope)?.id ?? null
}

// The space a new project or note is made in: the workspace being looked at, else one's own.
export const spaceForNew = (scope: Scope): number | null => (typeof scope === 'number' ? scope : null)
