import { expect, it, vi } from 'vitest'

// Review of #112, 4: after "Remove them" the window shows the file again,
// with the dialog closed, even when the round after it fails.
const h = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('@/lib/backend', () => ({
  BROWSER_INFO: { version: null, mcpCommand: '', updateReady: null },
  canReplicate: true,
  loadInfo: async () => ({ version: null, mcpCommand: '', updateReady: null }),
  loadState: async () => {
    h.calls.push('load')
    return { rev: 7, nextId: 1, projects: [], tasks: [] }
  },
  sync: async () => ({ rev: 0 }),
  takeOverHere: async () => {
    h.calls.push('takeOver')
  },
  replicate: async () => {
    h.calls.push('round')
    if (h.calls.filter((c) => c === 'round').length === 1) return { arrived: false, held: { account: { email: 'a@hop.dev' }, rows: 3, unsent: 0 } }
    throw new Error('offline')
  },
}))

const { getSnapshot, replicateNow, takeOver } = await import('@/lib/store')

it('reloads and closes the question whatever the round after it does', async () => {
  await replicateNow()
  expect(getSnapshot().held?.rows).toBe(3)
  await takeOver()
  expect(h.calls).toEqual(['round', 'takeOver', 'load', 'round'])
  expect(getSnapshot().held).toBeNull()
  expect(getSnapshot().data.rev).toBe(7)
})
