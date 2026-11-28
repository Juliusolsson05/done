import { beforeEach, describe, expect, it, vi } from 'vitest'

// The steps of signing out and deleting, in the order they happen. The app's
// commands and the store are stood in for; what is checked is the order.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  unsent: 0,
  inFlight: Promise.resolve() as Promise<void>,
  focus: null as { taskId: number | null; title: string } | null,
  failSignOut: false,
}))

vi.mock('@/lib/backend', () => ({
  canReplicate: true,
  unsentChanges: async () => {
    h.calls.push('count')
    return h.unsent
  },
  signOut: async (how: string) => {
    h.calls.push(`signOut:${how}`)
    if (h.failSignOut) throw new Error('failed')
  },
  deleteAccount: async () => {
    h.calls.push('delete')
  },
}))

vi.mock('@/lib/focus-store', () => ({
  getFocus: () => h.focus,
  endFocus: () => h.calls.push('endFocus'),
}))

vi.mock('@/lib/store', () => ({
  getSnapshot: () => ({
    data: {
      tasks: [{ id: 2, spaceId: 77 }],
      team: { me: '1', personal: 11, notifications: [], spaces: [{ id: 77, kind: 'workspace' }] },
    },
  }),
  replicateNow: async () => {
    h.calls.push('round')
  },
  idle: async () => {
    h.calls.push('idle')
    await h.inFlight
    h.calls.push('idle done')
  },
  stopSyncing: () => h.calls.push('stop'),
  resumeSyncing: () => h.calls.push('resume'),
}))

const { deleteAccountHere, prepareToLeave, signOutChecked } = await import('@/lib/leave')

beforeEach(() => {
  h.calls = []
  h.unsent = 0
  h.inFlight = Promise.resolve()
  h.focus = null
  h.failSignOut = false
})

describe('signOutChecked', () => {
  it('tries one last round and asks when changes are still unsent', async () => {
    h.unsent = 2
    expect(await signOutChecked()).toBe(2)
    expect(h.calls).toEqual(['round', 'idle', 'idle done', 'count'])
  })

  it('signs out once everything went up, with syncing stopped and the last round finished', async () => {
    expect(await signOutChecked()).toBe(0)
    expect(h.calls).toEqual(['round', 'idle', 'idle done', 'count', 'stop', 'idle', 'idle done', 'signOut:signed-out'])
  })

  it('waits for a round in flight before the clean-up, even when signing out anyway', async () => {
    let finish = () => {}
    h.inFlight = new Promise((resolve) => (finish = resolve))
    const done = signOutChecked(true, 'ended')
    await Promise.resolve()
    await Promise.resolve()
    expect(h.calls).toEqual(['stop', 'idle'])
    finish()
    await done
    expect(h.calls).toEqual(['stop', 'idle', 'idle done', 'signOut:ended'])
  })

  it('ends a focus session on a workspace task first, and not one on one’s own', async () => {
    h.focus = { taskId: 2, title: 'Ship the site' }
    await signOutChecked(true)
    expect(h.calls.indexOf('endFocus')).toBeLessThan(h.calls.indexOf('signOut:signed-out'))
    h.calls = []
    h.focus = { taskId: null, title: 'Deep work' }
    await signOutChecked(true)
    expect(h.calls).not.toContain('endFocus')
  })

  it('syncs again when signing out failed', async () => {
    h.failSignOut = true
    await expect(signOutChecked(true)).rejects.toThrow('failed')
    expect(h.calls.at(-1)).toBe('resume')
  })
})

describe('deleting the account', () => {
  it('counts what is unsent after one last round, for the question', async () => {
    h.unsent = 1
    expect(await prepareToLeave()).toBe(1)
    expect(h.calls).toEqual(['round', 'idle', 'idle done', 'count'])
  })

  it('stops syncing and waits for the round in flight before asking the server', async () => {
    await deleteAccountHere()
    expect(h.calls).toEqual(['stop', 'idle', 'idle done', 'delete'])
  })
})
