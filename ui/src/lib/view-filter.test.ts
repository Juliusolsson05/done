import { describe, expect, it } from 'vitest'
import { addDefaults, cleanFilter, filterChips, isFiltering, matchesFilter, NO_FILTER, onlyProject, type ViewFilter } from '@/lib/view-filter'
import type { Task } from '@/lib/tasks'

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
