import { describe, expect, it } from 'vitest'
import type { Notice, Team } from '@/lib/team'
import { ago, looksLikeEmail, moveWords, noticeDetail, noticeParts, ownProjects, sortNotices } from '@/lib/workspace-view'

const NOW = Date.UTC(2026, 10, 23, 12)
const notice = (id: string, kind: Notice['kind'], created: number, extra: Partial<Notice> = {}): Notice => ({
  id,
  kind,
  created,
  read: false,
  by: { id: '1002', name: 'Geart van Dam', picture: null },
  ...extra,
})

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
  notifications: [],
}
const data = {
  projects: [
    { id: 1, name: 'done', spaceId: 11 },
    { id: 2, name: 'Launch', spaceId: 77 },
  ],
  tasks: [
    { id: 10, title: 'a', notes: '', projectId: 1, start: null, due: null, priority: 4 },
    { id: 11, title: 'b', notes: '', projectId: 1, start: null, due: null, priority: 4, done: true },
    { id: 12, title: 'c', notes: '', projectId: 1, start: null, due: null, priority: 4, parentId: 10 },
    { id: 13, title: 'd', notes: '', projectId: 2, start: null, due: null, priority: 4 },
  ],
}

describe('notifications', () => {
  it('puts invites first, then the newest', () => {
    const sorted = sortNotices([notice('a', 'assigned', 3), notice('b', 'invite', 1), notice('c', 'joined', 5)])
    expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })

  it('says what happened in plain words', () => {
    expect(noticeParts(notice('a', 'invite', 1, { spaceName: 'Studio' }))).toEqual({ who: 'Geart', did: 'invited you to', what: 'Studio' })
    expect(noticeParts(notice('a', 'assigned', 1, { taskTitle: 'Ship it' }))).toEqual({ who: 'Geart', did: 'assigned you', what: 'Ship it' })
    expect(noticeParts(notice('a', 'joined', 1, { spaceName: 'Hop', by: { id: null, name: null, picture: null } })).who).toBe('Someone')
    expect(noticeDetail(notice('a', 'invite', NOW - 2 * 60_000, { members: 4 }), NOW)).toBe('2 minutes ago · 4 members')
    expect(noticeDetail(notice('a', 'assigned', NOW - 3600_000, { spaceName: 'Hop' }), NOW)).toBe('1 hour ago · Hop')
  })

  it('tells time the way people do', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('Just now')
    expect(ago(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(ago(NOW - 5 * 3600_000, NOW)).toBe('5 hours ago')
    expect(ago(NOW - 30 * 3600_000, NOW)).toBe('Yesterday')
    expect(ago(NOW - 3 * 86400_000, NOW)).toBe('3 days ago')
  })
})

describe('workspaces', () => {
  it('knows an address when it sees one', () => {
    expect(looksLikeEmail(' geart@hop.dev ')).toBe(true)
    expect(looksLikeEmail('geart')).toBe(false)
    expect(looksLikeEmail('geart@hop')).toBe(false)
  })

  it('offers only your own projects to move in', () => {
    expect(ownProjects(data, team).map((p) => p.name)).toEqual(['done'])
  })

  it('names who gains a project moved in, counting its open tasks', () => {
    expect(moveWords(data, team, 1, 77, '1001')).toMatchObject({
      title: 'Move “done” to Hop?',
      body: 'Geart will see and change it, with its 1 open task and its notes. Your time sheet stays yours.',
      action: 'Move to Hop',
    })
  })

  it('names who loses a project moved out', () => {
    const words = moveWords(data, team, 2, 11, '1001')
    expect(words?.body).toBe('Geart loses access to it, its 1 open task and its notes. Anyone assigned is taken off. You can move it back any time.')
    expect(words?.people.map((p) => p.id)).toEqual(['1002'])
    expect(moveWords(data, team, 99, 77, '1001')).toBeNull()
  })
})
