// The filter every task view shares: which tasks it shows. Plain data in,
// plain data out. Filtering only changes what is drawn; no task is written
// because of it. Every task view calls applyFilter, leaving out what the view
// decides itself (docs/plans/2026-11-27-universal-filter.md).
import { addDays, type Day } from '@/lib/days'
import { matchesQuery } from '@/lib/search'
import type { Project, Task, View } from '@/lib/tasks'

// A time window by due date. Late is its own choice: "this week" does not
// include what is already late, so the two never blur. "fortnight" (Next two
// weeks) is no longer offered; one saved before reads back as this week.
export type When = 'any' | 'late' | 'today' | 'week' | 'fortnight' | 'none'

export interface ViewFilter {
  // Chosen projects; null is the Inbox. Empty: every project.
  projects: (number | null)[]
  // Chosen priorities, 0 to 4 (0 is P0, 4 is none). Empty: every priority.
  priorities: number[]
  when: When
  // Every word must appear, in any order, case and accents ignored.
  words: string
  // Chosen people: 'me', 'nobody', or an account id. Empty: anyone's.
  people: string[]
}

export const NO_FILTER: ViewFilter = { projects: [], priorities: [], when: 'any', words: '', people: [] }

export const WHEN_NAMES: Record<When, string> = {
  any: 'Any time',
  late: 'Late',
  today: 'Due today',
  week: 'This week',
  fortnight: 'Next two weeks',
  none: 'No date',
}

// The windows the panel offers, in order.
export const WHEN_CHOICES: readonly When[] = ['any', 'late', 'today', 'week', 'none']

export const PRIORITY_SHORT: Record<number, string> = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'No priority' }

export const isFiltering = (filter: ViewFilter): boolean =>
  filter.projects.length > 0 || filter.priorities.length > 0 || filter.when !== 'any' || filter.words.trim() !== '' || filter.people.length > 0

function inWindow(task: Task, when: When, today: Day): boolean {
  const due = task.due
  switch (when) {
    case 'any':
      return true
    case 'none':
      return due === null
    case 'late':
      return due !== null && due < today && !task.done
    case 'today':
      return due === today
    // A task counts if any of its days fall in the window: a Timeline bar
    // drawn across this week shows under "this week" even if it is due later.
    // Late tasks (due before today) are their own choice.
    case 'week':
      return due !== null && due >= today && (task.start ?? due) <= addDays(today, 6)
    case 'fortnight':
      return due !== null && due >= today && (task.start ?? due) <= addDays(today, 13)
  }
}

// A task is anyone's chosen when someone chosen is on it: Me is you, Nobody
// is a task with nobody on it. `me` is your account id, if you have one.
function forPeople(task: Task, people: string[], me: string | null | undefined): boolean {
  const on = task.assignees ?? []
  return people.some((p) => (p === 'nobody' ? on.length === 0 : p === 'me' ? !!me && on.includes(me) : on.includes(p)))
}

// ---------- The filter every view shares ----------

// The five things a filter can choose. A view that decides one itself (Today
// decides when, a project page decides the project) neither shows nor applies it.
export type Dimension = 'words' | 'projects' | 'people' | 'priorities' | 'when'

const DIMENSIONS: readonly Dimension[] = ['words', 'projects', 'people', 'priorities', 'when']

export interface FilterContext {
  today: Day
  // Your account id, if you have one: what "Me" means.
  me: string | null
  // The projects in the current scope: their names are matched by words, and
  // a chosen project not among them (left over from another scope) is dropped.
  projects: Pick<Project, 'id' | 'name'>[]
  // What the view decides itself; skipped here.
  fixed: readonly Dimension[]
}

// The words of a filter found in a task: its title, its notes and its
// project's name ("hop" finds every task in Hop; a task with no project is in
// the Inbox), in any order, case and accents ignored, as the Focus picker and
// Cmd+K match. An empty query matches every task.
export function matchTask(task: Task, words: string, projects: FilterContext['projects']): boolean {
  const project = task.projectId === null ? 'Inbox' : (projects.find((p) => p.id === task.projectId)?.name ?? '')
  return matchesQuery([task.title, task.notes, project].join('\n'), words)
}

// A task by itself, against what the view lets the filter decide.
function passes(task: Task, filter: ViewFilter, ctx: FilterContext): boolean {
  const on = (d: Dimension) => !ctx.fixed.includes(d)
  if (on('projects')) {
    const known = new Set(ctx.projects.map((p) => p.id))
    const chosen = filter.projects.filter((p) => p === null || known.has(p))
    if (chosen.length > 0 && !chosen.includes(task.projectId)) return false
  }
  if (on('people') && filter.people.length > 0 && !forPeople(task, filter.people, ctx.me)) return false
  if (on('priorities') && filter.priorities.length > 0 && !filter.priorities.includes(task.priority)) return false
  // "Next two weeks" is no longer a choice: one saved before reads as this week.
  if (on('when') && !inWindow(task, filter.when === 'fortnight' ? 'week' : filter.when, ctx.today)) return false
  if (on('words') && !matchTask(task, filter.words, ctx.projects)) return false
  return true
}

// The tasks that pass, in the order given. A subtask passes when its task
// does, so a row that is shown keeps all its subtasks; a subtask whose task
// is not in the list is judged by itself.
export function applyFilter(tasks: Task[], filter: ViewFilter, ctx: FilterContext): Task[] {
  const parents = new Map(tasks.filter((t) => t.parentId == null).map((t) => [t.id, passes(t, filter, ctx)]))
  return tasks.filter((t) => {
    const parent = t.parentId != null ? parents.get(t.parentId) : undefined
    return parent ?? parents.get(t.id) ?? passes(t, filter, ctx)
  })
}

// What each task view lets the filter choose, in the order the panel shows
// them; null where the view has no filter. Everything else the view decides.
export function offered(view: View): Dimension[] | null {
  switch (view.kind) {
    case 'inbox':
      return ['words', 'priorities', 'when']
    case 'today':
    case 'upcoming':
      return ['words', 'projects', 'people', 'priorities']
    case 'project':
      return ['words', 'people', 'priorities', 'when']
    case 'mine':
      return ['words', 'projects', 'priorities', 'when']
    case 'board':
    case 'timeline':
      return [...DIMENSIONS]
    // Finished tasks carry no assignees yet, and their day is the day finished.
    case 'completed':
      return ['words', 'projects', 'priorities']
    default:
      return null
  }
}

// What the view decides itself, so the filter skips it there: every
// dimension it does not offer (all of them where there is no filter).
export function fixedFor(view: View): Dimension[] {
  const shown = offered(view) ?? []
  return DIMENSIONS.filter((d) => !shown.includes(d))
}

// What the view decides here and now: as fixedFor, and the person too where
// the scope has nobody to choose (one's own space), since its tasks have
// nobody on them and a person chosen elsewhere would empty the page.
export function fixedHere(view: View, hasPeople: boolean): Dimension[] {
  const fixed = fixedFor(view)
  return hasPeople || fixed.includes('people') ? fixed : [...fixed, 'people']
}

// The dimension a chip belongs to, from its key.
const dimensionOf = (key: string): Dimension =>
  key === 'words' ? 'words' : key === 'when' ? 'when' : key.startsWith('p') ? 'projects' : key.startsWith('r') ? 'priorities' : 'people'

// What is filtered, as chips under the title: each with its label and the
// filter as it would be without it, so removing one leaves the rest.
export interface Chip {
  key: string
  label: string
  without: ViewFilter
}

// `people` names the account ids a filter may hold, for their chips. A
// dimension in `fixed` gets no chips: the view decides it (see hiddenHere).
export function filterChips(
  filter: ViewFilter,
  projects: Pick<Project, 'id' | 'name'>[],
  people: { id: string; name: string }[] = [],
  fixed: readonly Dimension[] = [],
): Chip[] {
  const chips: Chip[] = []
  if (filter.words.trim()) chips.push({ key: 'words', label: `“${filter.words.trim()}”`, without: { ...filter, words: '' } })
  for (const id of filter.projects) {
    const name = id === null ? 'Inbox' : (projects.find((p) => p.id === id)?.name ?? 'A project')
    chips.push({ key: `p${id ?? 'inbox'}`, label: name, without: { ...filter, projects: filter.projects.filter((p) => p !== id) } })
  }
  for (const priority of [...filter.priorities].sort()) {
    chips.push({
      key: `r${priority}`,
      label: PRIORITY_SHORT[priority],
      without: { ...filter, priorities: filter.priorities.filter((p) => p !== priority) },
    })
  }
  if (filter.when !== 'any') chips.push({ key: 'when', label: WHEN_NAMES[filter.when], without: { ...filter, when: 'any' } })
  for (const person of filter.people) {
    const label = person === 'me' ? 'Me' : person === 'nobody' ? 'Nobody' : (people.find((p) => p.id === person)?.name ?? 'Someone')
    chips.push({ key: `a${person}`, label, without: { ...filter, people: filter.people.filter((p) => p !== person) } })
  }
  return chips.filter((chip) => !fixed.includes(dimensionOf(chip.key)))
}

// How many choices are set that this view decides itself, so the bar can
// say "2 hidden here" instead of letting them vanish.
export const hiddenHere = (filter: ViewFilter, fixed: readonly Dimension[]): number =>
  filterChips(filter, []).length - filterChips(filter, [], [], fixed).length

// A filter read back from storage, made safe: anything unreadable becomes no
// filter, and a project deleted since is dropped (it would hide everything,
// with no chip anyone could recognise).
export function cleanFilter(stored: unknown, projects: Pick<Project, 'id'>[]): ViewFilter {
  if (typeof stored !== 'object' || stored === null) return NO_FILTER
  const value = stored as Partial<Record<keyof ViewFilter, unknown>>
  const known = new Set(projects.map((p) => p.id))
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    // Once each: a repeated id would show as two chips and count twice.
    projects: [...new Set(list(value.projects).filter((p): p is number | null => p === null || (typeof p === 'number' && known.has(p))))],
    // 0 is P0 (#114): it was left out here, so it never stayed chosen.
    priorities: [...new Set(list(value.priorities).filter((p): p is number => Number.isInteger(p) && p >= 0 && p <= 4))],
    // Its own keys only: "toString" is "in" any object, and would hide everything.
    // "Next two weeks" left the panel: one saved before is this week.
    when: value.when === 'fortnight' ? 'week' : typeof value.when === 'string' && Object.hasOwn(WHEN_NAMES, value.when) ? (value.when as When) : 'any',
    words: typeof value.words === 'string' ? value.words : '',
    people: [...new Set(list(value.people).filter((p): p is string => typeof p === 'string' && p !== ''))],
  }
}

// The one project chosen, if exactly one (not the Inbox) is: where a task
// added on a filtered page should go, so it does not vanish from it.
export const onlyProject = (filter: ViewFilter): number | null => (filter.projects.length === 1 ? filter.projects[0] : null)

// What a task added on a filtered page gets, so it shows on the page it was
// added on: the one project, the one priority, and a due date inside the
// time window (today for today and this week). Words and "late" cannot be
// given to a new task; a line that sets its own date or priority wins over
// these, and so does what the view decides itself (`fixed`: a project page's
// project, Today's date).
export function addDefaults(
  filter: ViewFilter,
  today: Day,
  fixed: readonly Dimension[] = [],
): { projectId: number | null; priority: number | null; due: Day | null } {
  const on = (d: Dimension) => !fixed.includes(d)
  const due = on('when') && (filter.when === 'today' || filter.when === 'week' || filter.when === 'fortnight') ? today : null
  return {
    projectId: on('projects') ? onlyProject(filter) : null,
    priority: on('priorities') && filter.priorities.length === 1 ? filter.priorities[0] : null,
    due,
  }
}
