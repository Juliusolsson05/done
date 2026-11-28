import { describe, expect, it } from 'vitest'
import { pickerGroups, recentTaskIds, type PickerInput } from '@/lib/focus-picker'
import type { Project, Task } from '@/lib/tasks'

const TODAY = '2026-11-27'

const projects: Project[] = [
  { id: 1, name: 'Hop launch', color: 1 },
  { id: 2, name: 'Wedding', color: 4 },
  { id: 3, name: 'Home', color: 6 },
]

const task = (id: number, title: string, fields: Partial<Task> = {}): Task => ({
  id,
  title,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...fields,
})

// A day as it might look: a goal, a few things due today, something late,
// the week ahead, a long tail, and finished work with names close to open work.
const tasks: Task[] = [
  task(10, 'Sketch the invitation', { projectId: 2, due: TODAY, priority: 2, goalDay: TODAY }),
  task(11, 'Send the invitation list to Anna', { projectId: 2, due: TODAY, priority: 3 }),
  task(12, 'Write the launch post', { projectId: 1, due: TODAY, priority: 1 }),
  task(13, 'Fix sign-in on iPad', { projectId: 1, due: '2026-11-25', priority: 1 }),
  task(16, 'Call the plumber', { projectId: 3, due: '2026-11-26' }),
  task(14, 'Book the café for the dinner', { projectId: 2, due: '2026-11-29', priority: 3 }),
  task(15, 'Review pricing page copy', { projectId: 1, due: '2026-12-01', priority: 2 }),
  task(17, 'Clean the gutters', { projectId: 3 }),
  task(18, 'Read the Stripe docs'),
  task(19, 'Plan the onboarding emails', { projectId: 1, priority: 3 }),
  task(20, 'Sketch the invitation envelope', { projectId: 2, done: true, doneDay: '2026-11-26' }),
  task(21, 'Order invitation paper', { projectId: 2, due: '2026-12-12' }),
  task(22, 'Renew passport', { due: '2026-12-20', priority: 2 }),
  task(23, 'Pick a font', { projectId: 2, parentId: 10 }),
]

const input = (fields: Partial<PickerInput> = {}): PickerInput => ({
  tasks,
  projects,
  today: TODAY,
  query: '',
  recent: [18, 19],
  goalId: 10,
  ...fields,
})

const titles = (fields: Partial<PickerInput> = {}) => pickerGroups(input(fields)).flatMap((g) => g.tasks.map((t) => t.title))

describe('pickerGroups with nothing typed', () => {
  it('orders the groups by what matters today', () => {
    const groups = pickerGroups(input())
    expect(groups.map((g) => [g.heading, g.tasks.map((t) => t.id)])).toEqual([
      ['Today’s goal', [10]],
      // Today by priority.
      ['Today', [12, 11]],
      // Oldest first.
      ['Overdue', [13, 16]],
      // Within a week, nearest first.
      ['Soon', [14, 15]],
      // As focused, newest first.
      ['Recent', [18, 19]],
      ['Everything else', [22, 17, 21]],
    ])
  })

  it('never offers a finished task or a subtask', () => {
    const all = titles()
    expect(all).not.toContain('Sketch the invitation envelope')
    expect(all).not.toContain('Pick a font')
    // Every open task is offered exactly once.
    expect(all).toHaveLength(12)
    expect(new Set(all).size).toBe(12)
  })

  it('leaves out groups with nothing in them', () => {
    const groups = pickerGroups(input({ goalId: null, recent: [] }))
    expect(groups.map((g) => g.heading)).toEqual(['Today', 'Overdue', 'Soon', 'Everything else'])
    // Without a goal, it is simply one of today's tasks.
    expect(groups[0].tasks.map((t) => t.id)).toEqual([12, 10, 11])
  })

  it('drops a finished goal and finished recent tasks', () => {
    const finished = tasks.map((t) => (t.id === 10 || t.id === 18 ? { ...t, done: true } : t))
    const groups = pickerGroups(input({ tasks: finished }))
    expect(groups[0].heading).toBe('Today')
    expect(groups.find((g) => g.key === 'recent')?.tasks.map((t) => t.id)).toEqual([19])
  })

  it('lists a recently focused task once, in its most pressing group', () => {
    const groups = pickerGroups(input({ recent: [12, 17] }))
    expect(groups.find((g) => g.key === 'today')?.tasks.map((t) => t.id)).toContain(12)
    expect(groups.find((g) => g.key === 'recent')?.tasks.map((t) => t.id)).toEqual([17])
  })
})

describe('pickerGroups with a query', () => {
  it('finds words in any order and in part', () => {
    expect(titles({ query: 'invit sketch' })).toEqual(['Sketch the invitation'])
  })

  it('ignores case and accents', () => {
    expect(titles({ query: 'CAFE' })).toEqual(['Book the café for the dinner'])
    expect(titles({ query: 'Sign-In IPAD' })).toEqual(['Fix sign-in on iPad'])
  })

  it('finds tasks by their project, and Inbox for none', () => {
    expect(titles({ query: 'wedd' })).toEqual([
      'Sketch the invitation',
      'Send the invitation list to Anna',
      'Book the café for the dinner',
      'Order invitation paper',
    ])
    expect(titles({ query: 'inbox' })).toEqual(['Read the Stripe docs', 'Renew passport'])
  })

  it('puts title matches before project matches, each in the usual order', () => {
    // "home" is in the title of none of them but the project of two; "launch"
    // is in one title and the project of three more.
    expect(titles({ query: 'launch' })).toEqual([
      'Write the launch post',
      'Fix sign-in on iPad',
      'Review pricing page copy',
      'Plan the onboarding emails',
    ])
    expect(titles({ query: 'home' })).toEqual(['Call the plumber', 'Clean the gutters'])
  })

  it('returns one list without headings', () => {
    const groups = pickerGroups(input({ query: 'invitation' }))
    expect(groups).toHaveLength(1)
    expect(groups[0].heading).toBeNull()
    expect(groups[0].tasks.map((t) => t.id)).toEqual([10, 11, 21])
  })

  it('never finds a finished task, and nothing for a miss', () => {
    expect(titles({ query: 'envelope' })).toEqual([])
    expect(pickerGroups(input({ query: 'zebra' }))).toEqual([])
  })

  it('treats a query of spaces as nothing typed', () => {
    expect(pickerGroups(input({ query: '   ' }))[0].heading).toBe('Today’s goal')
  })
})

describe('recentTaskIds', () => {
  it('lists tasks newest first, each once, without blocks on no task', () => {
    const entries = [
      { taskId: 19, endedAt: 100 },
      { taskId: null, endedAt: 400 },
      { taskId: 18, endedAt: 300 },
      { taskId: 19, endedAt: 200 },
    ]
    expect(recentTaskIds(entries)).toEqual([18, 19])
  })
})
