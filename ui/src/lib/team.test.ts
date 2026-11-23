import { describe, expect, it } from 'vitest'
import type { Project, Task } from '@/lib/tasks'
import {
  defaultProjectFor,
  forMe,
  handleOf,
  initials,
  inScope,
  isPersonal,
  namesOf,
  shownFor,
  spaceOfTask,
  tintOf,
  unread,
  validScope,
  type Team,
} from '@/lib/team'

// As the server sends it: Julius's own space (11) and Hop (77).
const team: Team = {
  me: '1001',
  personal: 11,
  spaces: [
    { id: 11, kind: 'personal', name: '', owner: '1001', role: 'owner', members: [], invites: [] },
    {
      id: 77,
      kind: 'workspace',
      name: 'Hop',
      owner: '1001',
      role: 'owner',
      members: [
        { id: '1001', name: 'Julius Olsson', email: 'julius@hop.dev', picture: '', role: 'owner' },
        { id: '1002', name: 'Geart', email: 'geart@hop.dev', picture: '', role: 'member' },
      ],
      invites: [],
    },
  ],
  notifications: [
    { id: 'invite-1', kind: 'invite', read: false, created: 1, by: { id: '9', name: 'Ana', picture: null } },
    { id: '2', kind: 'assigned', read: true, created: 2, by: { id: '1002', name: 'Geart', picture: null } },
  ],
}

const task = (id: number, fields: Partial<Task> = {}): Task => ({
  id,
  title: 't' + id,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...fields,
})
const projects: Project[] = [
  { id: 1, name: 'Home', spaceId: 11 },
  { id: 2, name: 'Launch', spaceId: 77 },
  // Made on this device a moment ago, not synced yet.
  { id: 3, name: 'New', spaceId: null },
]
const tasks: Task[] = [
  task(10, { projectId: 1 }),
  task(11, { projectId: 2 }),
  task(12, { parentId: 11 }),
  task(13),
  // No project, but in Hop: its project was deleted there.
  task(14, { spaceId: 77 }),
  // Just moved into Launch on this device, the server has not said yet.
  task(15, { projectId: 2, spaceId: 11 }),
]

describe('spaces', () => {
  it('puts a task where its project is, a subtask where its task is', () => {
    const data = { projects, tasks }
    expect(tasks.map((t) => spaceOfTask(t, data))).toEqual([11, 77, 77, null, 77, 77])
  })

  it('shows each scope its own projects and tasks, and All everything', () => {
    const data = { projects, tasks }
    const ids = (s: ReturnType<typeof shownFor>) => [s.projects.map((p) => p.id), s.tasks.map((t) => t.id)]
    expect(ids(shownFor(data, 'all', team))).toEqual([
      [1, 2, 3],
      [10, 11, 12, 13, 14, 15],
    ])
    expect(ids(shownFor(data, 'personal', team))).toEqual([
      [1, 3],
      [10, 13],
    ])
    expect(ids(shownFor(data, 77, team))).toEqual([[2], [11, 12, 14, 15]])
  })

  it('counts a space it does not know as one’s own, so nothing goes missing', () => {
    expect(isPersonal(null, team)).toBe(true)
    expect(isPersonal(11, team)).toBe(true)
    expect(isPersonal(999, team)).toBe(true)
    expect(isPersonal(77, team)).toBe(false)
    expect(inScope(999, 'personal', team)).toBe(true)
  })

  it('falls back to All when the workspace looked at is gone', () => {
    expect(validScope(77, team)).toBe(77)
    expect(validScope(78, team)).toBe('all')
    expect(validScope('personal', { ...team, spaces: [team.spaces[0]] })).toBe('all')
  })

  it('leaves someone else’s workspace task out of All’s day, not yours or nobody’s', () => {
    expect(forMe(task(1), '1001')).toBe(true)
    expect(forMe(task(1, { assignees: ['1001', '1002'] }), '1001')).toBe(true)
    expect(forMe(task(1, { assignees: ['1002'] }), '1001')).toBe(false)
    expect(forMe(task(1, { assignees: ['1002'] }), null)).toBe(true)
  })

  it('adds to a workspace’s first project, since the Inbox is one’s own', () => {
    expect(defaultProjectFor(77, projects)).toBe(2)
    expect(defaultProjectFor('all', projects)).toBe(null)
    expect(defaultProjectFor(78, projects)).toBe(null)
  })
})

describe('people', () => {
  it('names and marks people plainly', () => {
    expect(initials('Julius Olsson')).toBe('JO')
    expect(initials('Geart')).toBe('G')
    expect(initials('', 'ana@studio.se')).toBe('A')
    expect(handleOf({ name: 'Julius Olsson', email: 'j@x' })).toBe('julius')
    expect(handleOf({ name: '', email: 'ana.lind@studio.se' })).toBe('analind')
    expect(namesOf(['Julius', 'Geart', 'Ana'])).toBe('Julius, Geart and Ana')
    expect(namesOf(['Geart'])).toBe('Geart')
    expect(tintOf('1002')).toBe(tintOf('1002'))
    expect(unread(team)).toBe(1)
  })
})
