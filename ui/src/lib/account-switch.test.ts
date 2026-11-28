import { describe, expect, it } from 'vitest'
import { focusLeaves, heldMessage, signOutQuestion, unsentCount } from '@/lib/account-switch'
import type { Session } from '@/lib/focus'
import type { Task } from '@/lib/tasks'
import type { Team } from '@/lib/team'

const team: Team = {
  me: '1001',
  personal: 11,
  spaces: [
    { id: 11, kind: 'personal', name: '', owner: '1001', role: 'owner', members: [], invites: [] },
    { id: 77, kind: 'workspace', name: 'Hop', owner: '1001', role: 'owner', members: [], invites: [] },
  ],
  notifications: [],
}

const task = (id: number, spaceId: number | null): Task => ({ id, title: 'T', notes: '', projectId: null, priority: 4, done: false, spaceId }) as Task
const focusOn = (taskId: number | null) => ({ taskId, title: 'Ship the site' }) as Session

describe('unsentCount', () => {
  it('adds up every kind of change a round would send', () => {
    expect(unsentCount({ rows: { tasks: [1, 2], projects: [1], gone: [1], assignees: [] } })).toBe(4)
    expect(unsentCount({ rows: {} })).toBe(0)
  })

  it('leaves out another account’s changes, which signing out keeps as they are', () => {
    expect(unsentCount({ rows: {}, held: { account: { email: 'a@hop.dev' }, rows: 5, unsent: 3 } })).toBe(0)
  })
})

describe('what the person is told', () => {
  it('asks before signing out with changes not sent', () => {
    expect(signOutQuestion(1)).toMatch(/^1 change not sent yet\. Sign out anyway\?/)
    expect(signOutQuestion(3)).toMatch(/^3 changes not sent yet/)
  })

  it('names the other account and what removing means', () => {
    const unsent = heldMessage({ account: { id: '1001', email: 'julius@hop.dev' }, rows: 4, unsent: 2 })
    expect(unsent.body).toBe(
      '2 changes from julius@hop.dev were never sent. Sign in as julius@hop.dev to send them, or remove them from this device.',
    )
    expect(unsent.drop).toBe('Remove them')
    const synced = heldMessage({ account: { email: '' }, rows: 4, unsent: 0 })
    expect(synced.body).toBe(
      'This device has tasks from your other account. They are in that account. Take them off this device to use this account here?',
    )
    expect(synced.drop).toBe('Continue')
    expect(heldMessage({ account: { email: 'a@b.c' }, rows: 1, unsent: 1 }).body).toMatch(/^1 change from a@b\.c was never sent/)
  })
})

describe('focusLeaves', () => {
  const tasks = [task(1, 11), task(2, 77), task(3, null)]

  it('ends a session on a workspace task, and only that', () => {
    expect(focusLeaves(focusOn(2), tasks, team)).toBe(true)
    expect(focusLeaves(focusOn(1), tasks, team)).toBe(false)
    expect(focusLeaves(focusOn(3), tasks, team)).toBe(false)
    expect(focusLeaves(focusOn(null), tasks, team)).toBe(false)
    expect(focusLeaves(null, tasks, team)).toBe(false)
  })

  it('ends one on a task not loaded only when there are workspaces it could be in', () => {
    expect(focusLeaves(focusOn(9), tasks, team)).toBe(true)
    expect(focusLeaves(focusOn(9), tasks, { ...team, spaces: [team.spaces[0]] })).toBe(false)
    expect(focusLeaves(focusOn(2), tasks, null)).toBe(false)
  })
})
