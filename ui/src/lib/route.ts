// The address of a place in the app, and back. The table here is the whole
// of it; crates/server/src/routes.rs keeps the same table so the web server
// answers these paths with the app. Ids are the only data an address holds:
// never a title, an email or a token.
import type { Data, View } from '@/lib/tasks'
import { inScope, isPersonal, spaceOfTask, workspaces, type Scope, type Team } from '@/lib/team'

export interface Route {
  view: View
  // The task open over the view, if any.
  task: number | null
}

export const HOME: Route = { view: { kind: 'today' }, task: null }

// The views with a path of one word and nothing else.
const PLAIN: Record<string, View['kind']> = {
  today: 'today',
  inbox: 'inbox',
  upcoming: 'upcoming',
  assigned: 'mine',
  timeline: 'timeline',
  board: 'board',
  focus: 'focus',
  'time-sheet': 'timesheet',
  completed: 'completed',
  notes: 'notes',
  settings: 'settings',
  lists: 'lists',
  notifications: 'notifications',
}
const WORD = Object.fromEntries(Object.entries(PLAIN).map(([word, kind]) => [kind, word])) as Record<View['kind'], string>

// An id as an address writes it: digits only, and a number JavaScript holds exactly.
function idOf(text: string | undefined | null): number | null {
  if (!text || !/^\d{1,20}$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

// The view a path names, or null for a path that is not one of the app's.
function viewOf(path: string): View | null {
  // One trailing slash is forgiven; an empty segment anywhere else is not.
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (trimmed === '/') return { kind: 'today' }
  if (!trimmed.startsWith('/')) return null
  const [word, rest, more, ...extra] = trimmed.slice(1).split('/')
  if (extra.length > 0) return null
  if (rest === undefined) {
    // Own words only: `constructor` is not a view.
    return Object.hasOwn(PLAIN, word) ? ({ kind: PLAIN[word] } as View) : null
  }
  if (word === 'project' && more === undefined) {
    const id = idOf(rest)
    return id === null ? null : { kind: 'project', id }
  }
  if (word === 'notes' && more === undefined) {
    const id = idOf(rest)
    return id === null ? null : { kind: 'notes', id }
  }
  if (word === 'settings' && rest === 'workspace') {
    const id = idOf(more)
    return id === null ? null : { kind: 'settings', space: id }
  }
  return null
}

// Where an address points: the path and search of a URL, or a whole URL.
// Null for an address that is not a place in the app. A `task` that is not
// an id is left out rather than spoiling the rest.
export function parseRoute(address: string): Route | null {
  let rest = address
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(rest)
  if (scheme) rest = rest.slice(scheme[0].length) || '/'
  const hash = rest.indexOf('#')
  if (hash >= 0) rest = rest.slice(0, hash)
  const question = rest.indexOf('?')
  const path = question >= 0 ? rest.slice(0, question) : rest
  const search = question >= 0 ? rest.slice(question + 1) : ''
  const view = viewOf(path)
  if (!view) return null
  const task = idOf(new URLSearchParams(search).get('task'))
  return { view, task }
}

// The one address for a place, so the same place always reads the same.
export function formatRoute(route: Route): string {
  const v = route.view
  const path =
    v.kind === 'project'
      ? `/project/${v.id}`
      : v.kind === 'notes' && v.id !== undefined
        ? `/notes/${v.id}`
        : v.kind === 'settings' && v.space !== undefined
          ? `/settings/workspace/${v.space}`
          : `/${WORD[v.kind]}`
  return route.task === null ? path : `${path}?task=${route.task}`
}

// The window's title: the kind of place only. A task, project or note name
// would end up in the browser's history on a shared computer.
const NAMES: Record<View['kind'], string> = {
  today: 'Today',
  inbox: 'Inbox',
  upcoming: 'Upcoming',
  mine: 'Assigned to me',
  timeline: 'Timeline',
  board: 'Board',
  focus: 'Focus',
  timesheet: 'Time sheet',
  completed: 'Completed',
  notes: 'Notes',
  settings: 'Settings',
  lists: 'Lists',
  notifications: 'Notifications',
  project: 'Project',
}
export function titleOf(route: Route): string {
  const v = route.view
  const name = v.kind === 'notes' && v.id !== undefined ? 'Note' : v.kind === 'settings' && v.space !== undefined ? 'Workspace' : NAMES[v.kind]
  return `${name} · done`
}

// Whether `child` is opened over `parent`, to be closed back to it: a task
// over its view, a note over the list of notes, a workspace over Settings.
export function isOver(parent: Route, child: Route): boolean {
  if (parent.task === null && child.task !== null) return formatRoute({ ...child, task: null }) === formatRoute(parent)
  if (parent.task !== null || child.task !== null) return false
  const p = parent.view
  const c = child.view
  if (p.kind === 'notes' && c.kind === 'notes') return p.id === undefined && c.id !== undefined
  if (p.kind === 'settings' && c.kind === 'settings') return p.space === undefined && c.space !== undefined
  return false
}

// What the browser's history holds for the entry you are on: its address,
// the address it was pushed from (null when nothing of the app's is behind
// it), and whether it is opened over that one.
export interface Entry {
  path: string
  prev: string | null
  over: boolean
}

export type Step =
  | { kind: 'none' }
  | { kind: 'push'; entry: Entry }
  | { kind: 'replace'; entry: Entry }
  // Going back to the entry this one was opened over.
  | { kind: 'back' }

// How to get from the entry you are on to `next`. `replace` is for a move
// the app made by itself (the newest note opened on a wide screen), which is
// not a step to go back through.
export function stepTo(current: Entry, next: Route, replace = false): Step {
  const path = formatRoute(next)
  if (path === current.path) return { kind: 'none' }
  const here = parseRoute(current.path)
  // Closing what was opened over the entry behind: back to it, so Back does
  // not reopen it and Forward does.
  if (current.over && path === current.prev) return { kind: 'back' }
  // Another task over the same view, or another note over the same list:
  // the open thing changes, the way back does not.
  if (current.over && current.prev !== null) {
    const under = parseRoute(current.prev)
    if (under && isOver(under, next)) return { kind: 'replace', entry: { path, prev: current.prev, over: true } }
  }
  // Closing something that was loaded open, from a link or a reload: there
  // is no entry under it to go back to, so the place under it takes its
  // entry, and Back does not open it again.
  if (here !== null && isOver(next, here)) return { kind: 'replace', entry: { path, prev: current.prev, over: false } }
  // Leaving what is open for somewhere else: that place takes its entry, so
  // Back goes to the view it was opened over.
  if (current.over || replace) return { kind: 'replace', entry: { path, prev: current.prev, over: false } }
  return { kind: 'push', entry: { path, prev: current.path, over: here !== null && isOver(here, next) } }
}

// Said for a link to something this account cannot see. Deleted and not
// yours are one message on purpose: two would tell a non-member the id exists.
export const NO_ACCESS = "You don't have access to this, or it was deleted."

// The picker's place for a row in `spaceId`.
export const scopeFor = (spaceId: number | null | undefined, team: Team | null | undefined): Scope =>
  isPersonal(spaceId, team) ? (workspaces(team).length ? 'personal' : 'all') : (spaceId as number)

// Where an address takes this account, given what it holds: the place, the
// scope to move the picker to (a link into another space you are in), and
// what to say when part of it is not there. Notes are checked by the Notes
// page, which loads them itself. `phone` is whether Lists and the
// notifications are pages of their own here.
export function resolve(
  route: Route,
  data: Pick<Data, 'projects' | 'tasks'>,
  team: Team | null | undefined,
  scope: Scope,
  phone: boolean,
): { route: Route; scope?: Scope; said?: string } {
  let view = route.view
  let task = route.task
  let said: string | undefined
  let to: Scope | undefined
  const visit = (spaceId: number | null | undefined) => {
    if (!inScope(spaceId, to ?? scope, team)) to = scopeFor(spaceId, team)
  }
  if (view.kind === 'project') {
    const project = data.projects.find((p) => p.id === (view as { id: number }).id)
    if (project) visit(project.spaceId)
    else {
      said = NO_ACCESS
      view = { kind: 'today' }
      task = null
    }
  }
  if (view.kind === 'settings' && view.space !== undefined && !workspaces(team).some((s) => s.id === (view as { space: number }).space)) {
    said = NO_ACCESS
    view = { kind: 'settings' }
  }
  if ((view.kind === 'lists' || view.kind === 'notifications') && !phone) view = { kind: 'today' }
  if (view.kind === 'mine' && workspaces(team).length === 0) view = { kind: 'today' }
  if (task !== null) {
    const found = data.tasks.find((t) => t.id === task)
    if (found) visit(spaceOfTask(found, data))
    else {
      said = NO_ACCESS
      task = null
    }
  }
  return { route: { view, task }, ...(to !== undefined && to !== scope ? { scope: to } : {}), ...(said ? { said } : {}) }
}
