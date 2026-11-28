import { describe, expect, it } from 'vitest'
import {
  addDefaults,
  applyFilter,
  cleanFilter,
  filterChips,
  fixedFor,
  isFiltering,
  matchesFilter,
  matchTask,
  NO_FILTER,
  offered,
  onlyProject,
  type Dimension,
  type FilterContext,
  type ViewFilter,
} from '@/lib/view-filter'
import type { Task, View } from '@/lib/tasks'

const today = '2026-11-23'
const task = (id: number, fields: Partial<Task> = {}): Task => ({
  id,
  title: 'Task ' + id,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...fields,
})
const HOP = 8
const CATCH_UP = 9
const projects = [
  { id: HOP, name: 'Hop' },
  { id: CATCH_UP, name: 'Catch Up' },
]
const filter = (fields: Partial<ViewFilter>): ViewFilter => ({ ...NO_FILTER, ...fields })
const ids = (tasks: Task[], f: ViewFilter) => tasks.filter((t) => matchesFilter(t, f, today)).map((t) => t.id)

describe('the Board and Timeline filter', () => {
  const tasks = [
    task(1, { projectId: HOP, priority: 1, due: '2026-11-20', title: 'Answer angels' }),
    task(2, { projectId: HOP, priority: 2, due: today }),
    task(3, { projectId: CATCH_UP, priority: 1, due: '2026-11-29' }),
    task(4, { priority: 4, due: '2026-12-06', notes: 'Ask Anton about the angel round' }),
    task(5, { projectId: HOP, priority: 3 }),
    task(6, { projectId: HOP, priority: 1, due: '2026-11-20', done: true, doneDay: today }),
  ]

  it('shows everything with no filter', () => {
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(ids(tasks, NO_FILTER)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps the chosen projects, the Inbox included', () => {
    expect(ids(tasks, filter({ projects: [HOP] }))).toEqual([1, 2, 5, 6])
    expect(ids(tasks, filter({ projects: [CATCH_UP, null] }))).toEqual([3, 4])
  })

  it('keeps the chosen priorities, and narrows further with every choice', () => {
    expect(ids(tasks, filter({ priorities: [1] }))).toEqual([1, 3, 6])
    expect(ids(tasks, filter({ projects: [HOP], priorities: [1] }))).toEqual([1, 6])
  })

  it('keeps a time window by due date, with late as its own choice', () => {
    expect(ids(tasks, filter({ when: 'late' }))).toEqual([1])
    expect(ids(tasks, filter({ when: 'today' }))).toEqual([2])
    // This week runs from today through six days on: the 29th is in, the 30th would not be.
    expect(ids(tasks, filter({ when: 'week' }))).toEqual([2, 3])
    expect(ids(tasks, filter({ when: 'fortnight' }))).toEqual([2, 3, 4])
    expect(ids(tasks, filter({ when: 'none' }))).toEqual([5])
  })

  it('counts a task spanning into the window, as its Timeline bar does', () => {
    const spanning = [task(7, { start: '2026-11-25', due: '2026-12-03' }), task(8, { start: '2026-12-01', due: '2026-12-03' })]
    expect(ids(spanning, filter({ when: 'week' }))).toEqual([7])
  })

  it('finds every word in the title or the notes, case ignored', () => {
    expect(ids(tasks, filter({ words: 'ANGEL' }))).toEqual([1, 4])
    expect(ids(tasks, filter({ words: 'angel anton' }))).toEqual([4])
  })
})

describe('the chips', () => {
  it('say what is filtered, and each removes only itself', () => {
    const f = filter({ projects: [HOP, null], priorities: [2, 1], when: 'week', words: ' angel ' })
    const chips = filterChips(f, projects)
    expect(chips.map((c) => c.label)).toEqual(['“angel”', 'Hop', 'Inbox', 'P1', 'P2', 'This week'])
    expect(chips.find((c) => c.label === 'Hop')!.without).toEqual({ ...f, projects: [null] })
    expect(chips.find((c) => c.label === 'This week')!.without).toEqual({ ...f, when: 'any' })
  })
})

describe('a stored filter', () => {
  it('drops a project deleted since, and anything unreadable', () => {
    expect(cleanFilter({ projects: [HOP, 404, null, 'x'], priorities: [1, 9], when: 'soon', words: 3 }, projects)).toEqual({
      projects: [HOP, null],
      priorities: [1],
      when: 'any',
      words: '',
      people: [],
    })
    // A name every object has must not pass for a time window.
    expect(cleanFilter({ when: 'toString' }, projects).when).toBe('any')
    expect(cleanFilter({ projects: [HOP, HOP], priorities: [1, 1] }, projects)).toMatchObject({ projects: [HOP], priorities: [1] })
    expect(cleanFilter('junk', projects)).toEqual(NO_FILTER)
    expect(cleanFilter(null, projects)).toEqual(NO_FILTER)
  })
})

describe('quick add on a filtered page', () => {
  it('goes into the one project chosen, and nowhere special otherwise', () => {
    expect(onlyProject(filter({ projects: [HOP] }))).toBe(HOP)
    expect(onlyProject(filter({ projects: [HOP, CATCH_UP] }))).toBeNull()
    expect(onlyProject(filter({ projects: [null] }))).toBeNull()
    expect(onlyProject(NO_FILTER)).toBeNull()
  })

  it('gives a new task what keeps it on the page: the priority and a date in the window', () => {
    expect(addDefaults(filter({ projects: [HOP], priorities: [1], when: 'today' }), today)).toEqual({ projectId: HOP, priority: 1, due: today })
    expect(addDefaults(filter({ priorities: [1, 2], when: 'week' }), today)).toEqual({ projectId: null, priority: null, due: today })
    expect(addDefaults(filter({ when: 'none' }), today)).toEqual({ projectId: null, priority: null, due: null })
  })
})

describe('people', () => {
  const on = (id: number, assignees?: string[]) => ({ id, title: 't', notes: '', projectId: null, start: null, due: null, priority: 4, assignees })
  const all = [on(1), on(2, ['1001']), on(3, ['1002']), on(4, ['1001', '1002'])]
  const shown = (people: string[], me: string | null = '1001') => all.filter((t) => matchesFilter(t, filter({ people }), today, me)).map((t) => t.id)

  it('keeps the tasks someone chosen is on', () => {
    expect(shown(['me'])).toEqual([2, 4])
    expect(shown(['nobody'])).toEqual([1])
    expect(shown(['1002', 'nobody'])).toEqual([1, 3, 4])
    // Me without an account is nobody's tasks only.
    expect(shown(['me'], null)).toEqual([])
    expect(isFiltering(filter({ people: ['me'] }))).toBe(true)
  })

  it('names people on their chips and reads them back from storage', () => {
    const chips = filterChips(filter({ people: ['me', '1002', 'nobody', 'gone'] }), [], [{ id: '1002', name: 'Geart' }])
    expect(chips.map((c) => c.label)).toEqual(['Me', 'Geart', 'Nobody', 'Someone'])
    expect(chips[1].without.people).toEqual(['me', 'nobody', 'gone'])
    expect(cleanFilter({ people: ['me', 'me', 3, ''] }, []).people).toEqual(['me'])
  })
})

describe('bugs in the Board and Timeline filter', () => {
  // #114: the panel offers P0, but the filter is read back through cleanFilter
  // on every read, which kept only 1 to 4, so P0 never stayed on.
  it('keeps P0 when the filter is read back', () => {
    const stored = JSON.parse(JSON.stringify(filter({ priorities: [0, 1] })))
    expect(cleanFilter(stored, projects).priorities).toEqual([0, 1])
    const tasks = [task(1, { priority: 0 }), task(2, { priority: 1 }), task(3, { priority: 4 })]
    expect(ids(tasks, cleanFilter({ priorities: [0] }, projects))).toEqual([1])
    expect(filterChips(cleanFilter({ priorities: [0] }, projects), projects).map((c) => c.label)).toEqual(['P0'])
  })

  it('still drops priorities that do not exist', () => {
    expect(cleanFilter({ priorities: [-1, 0, 1.5, 5, '0'] }, projects).priorities).toEqual([0])
  })

  it('finds words with or without accents, as Cmd+K does', () => {
    const tasks = [task(1, { title: 'Book the Café for Friday' }), task(2, { notes: 'Ring the café' }), task(3, { title: 'Cafeteria menu' })]
    expect(ids(tasks, filter({ words: 'cafe' }))).toEqual([1, 2, 3])
    expect(ids(tasks, filter({ words: 'CAFÉ friday' }))).toEqual([1])
  })
})

describe('one filter for every view (applyFilter)', () => {
  // A scope with a personal project (Wedding) and a workspace's (Hop), as All
  // shows them. 1001 is me, 1002 the co-founder.
  const WEDDING = 3
  const scope = [
    { id: HOP, name: 'Hop' },
    { id: WEDDING, name: 'Wedding' },
  ]
  const tasks: Task[] = [
    task(1, { title: 'Ship the pricing page', projectId: HOP, priority: 0, due: '2026-11-21', assignees: ['1001'], spaceId: 2 }),
    task(2, { title: 'Answer the angels', projectId: HOP, priority: 1, due: today, assignees: ['1002'], spaceId: 2 }),
    task(3, { title: 'Sketch onboarding', projectId: HOP, priority: 2, spaceId: 2 }),
    task(4, { title: 'Book the Café for the dinner', projectId: WEDDING, priority: 3, due: '2026-11-27' }),
    task(5, { title: 'Renew passport', priority: 4, notes: 'Photo at the café on the corner' }),
    task(6, { title: 'Pick a photographer', projectId: WEDDING, priority: 1, due: '2026-12-02' }),
    // Subtasks of the pricing page, listed under it.
    task(7, { title: 'Write the copy', parentId: 1, projectId: HOP, priority: 4, spaceId: 2 }),
    task(8, { title: 'Ask Anton for numbers', parentId: 1, projectId: HOP, priority: 4, done: true, spaceId: 2 }),
  ]
  const ctx = (fields: Partial<FilterContext> = {}): FilterContext => ({ today, me: '1001', projects: scope, fixed: [], ...fields })
  const shown = (f: Partial<ViewFilter>, c: Partial<FilterContext> = {}) => applyFilter(tasks, filter(f), ctx(c)).map((t) => t.id)

  it('shows everything with no filter, in the order given', () => {
    expect(shown({})).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('finds words in the title, the notes or the project name, accents ignored', () => {
    expect(shown({ words: 'cafe' })).toEqual([4, 5])
    expect(shown({ words: 'hop' })).toEqual([1, 2, 3, 7, 8])
    expect(shown({ words: 'wedding dinner' })).toEqual([4])
    expect(shown({ words: 'inbox' })).toEqual([5])
    expect(matchTask(tasks[0], 'PRICING hop', scope)).toBe(true)
    expect(matchTask(tasks[0], 'pricing wedding', scope)).toBe(false)
  })

  it('keeps P0 and the other chosen priorities', () => {
    expect(shown({ priorities: [0] })).toEqual([1, 7, 8])
    expect(shown({ priorities: [0, 1] })).toEqual([1, 2, 6, 7, 8])
    expect(shown({ priorities: [4] })).toEqual([5])
  })

  it('lets a subtask follow its task, whatever the subtask itself is', () => {
    // The subtasks are P4 and match no word of "pricing", yet stay with their task.
    expect(shown({ words: 'pricing' })).toEqual([1, 7, 8])
    // And go with it: the task is not P4, so its P4 subtasks are not shown on their own.
    expect(shown({ priorities: [4] })).not.toContain(7)
    // A subtask whose task is not in the list is judged by itself.
    expect(applyFilter([tasks[6]], filter({ words: 'copy' }), ctx()).map((t) => t.id)).toEqual([7])
    expect(applyFilter([tasks[6]], filter({ words: 'pricing' }), ctx()).map((t) => t.id)).toEqual([])
  })

  it('keeps late, today, this week and undated tasks by due date', () => {
    expect(shown({ when: 'late' })).toEqual([1, 7, 8])
    expect(shown({ when: 'today' })).toEqual([2])
    expect(shown({ when: 'week' })).toEqual([2, 4])
    expect(shown({ when: 'none' })).toEqual([3, 5])
  })

  it('reads a saved "next two weeks" as this week', () => {
    expect(shown({ when: 'fortnight' })).toEqual(shown({ when: 'week' }))
    expect(shown({ when: 'fortnight' })).not.toContain(6)
  })

  it('keeps the tasks of the people chosen, workspace and personal alike', () => {
    expect(shown({ people: ['me'] })).toEqual([1, 7, 8])
    expect(shown({ people: ['1002'] })).toEqual([2])
    // Nobody is on a personal task either.
    expect(shown({ people: ['nobody'] })).toEqual([3, 4, 5, 6])
    expect(shown({ people: ['me'] }, { me: null })).toEqual([])
  })

  it('narrows with every dimension together', () => {
    expect(shown({ projects: [HOP], priorities: [0, 1], people: ['me'] })).toEqual([1, 7, 8])
    expect(shown({ projects: [WEDDING, null], words: 'cafe' })).toEqual([4, 5])
  })

  it('ignores what the view decides itself', () => {
    // A project page for Wedding: a stored "Hop only" must not empty it.
    const wedding = tasks.filter((t) => t.projectId === WEDDING)
    const onPage = applyFilter(wedding, filter({ projects: [HOP], priorities: [1] }), ctx({ fixed: fixedFor({ kind: 'project', id: WEDDING }) }))
    expect(onPage.map((t) => t.id)).toEqual([6])
    // Today decides when: "No date" does not apply there.
    expect(shown({ when: 'none' }, { fixed: fixedFor({ kind: 'today' }) })).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // Nothing applies on a view with no filter.
    expect(shown({ words: 'zzz', projects: [HOP], people: ['me'], priorities: [0], when: 'late' }, { fixed: fixedFor({ kind: 'settings' }) })).toHaveLength(8)
  })

  it('drops a project chosen in another scope', () => {
    // Hop was chosen in All; the scope is now personal, where Hop is not.
    const personal = [{ id: WEDDING, name: 'Wedding' }]
    const mine = tasks.filter((t) => t.spaceId == null)
    expect(applyFilter(mine, filter({ projects: [HOP] }), ctx({ projects: personal })).map((t) => t.id)).toEqual([4, 5, 6])
    expect(applyFilter(mine, filter({ projects: [HOP, WEDDING] }), ctx({ projects: personal })).map((t) => t.id)).toEqual([4, 6])
    // The Inbox is in every scope.
    expect(applyFilter(mine, filter({ projects: [HOP, null] }), ctx({ projects: personal })).map((t) => t.id)).toEqual([5])
  })
})

describe('what each view offers', () => {
  const views: [View, Dimension[] | null][] = [
    [{ kind: 'inbox' }, ['words', 'priorities', 'when']],
    [{ kind: 'today' }, ['words', 'projects', 'people', 'priorities']],
    [{ kind: 'upcoming' }, ['words', 'projects', 'people', 'priorities']],
    [{ kind: 'project', id: HOP }, ['words', 'people', 'priorities', 'when']],
    [{ kind: 'mine' }, ['words', 'projects', 'priorities', 'when']],
    [{ kind: 'board' }, ['words', 'projects', 'people', 'priorities', 'when']],
    [{ kind: 'timeline' }, ['words', 'projects', 'people', 'priorities', 'when']],
    [{ kind: 'completed' }, ['words', 'projects', 'priorities']],
    [{ kind: 'focus' }, null],
    [{ kind: 'timesheet' }, null],
    [{ kind: 'notes' }, null],
    [{ kind: 'settings' }, null],
    [{ kind: 'lists' }, null],
    [{ kind: 'notifications' }, null],
  ]

  it.each(views)('%o offers %o, and fixes the rest', (view, wanted) => {
    expect(offered(view)).toEqual(wanted)
    const fixed = fixedFor(view)
    expect([...(wanted ?? []), ...fixed].sort()).toEqual(['people', 'priorities', 'projects', 'when', 'words'])
    expect(fixed.some((d) => wanted?.includes(d))).toBe(false)
  })
})
