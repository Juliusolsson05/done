import { afterEach, describe, expect, it, vi } from 'vitest'
import { appleAfterDeletion, deletedNotice, APPLE_DISCONNECT_HELP } from '@/lib/apple-after-deletion'

describe('what the app says about Apple after a deletion', () => {
  it('says done disconnected Sign in with Apple when the server revoked the grant', () => {
    expect(deletedNotice(true, 'revoked')).toEqual({ text: 'Your account was deleted, and done disconnected Sign in with Apple.' })
  })

  it('tells an Apple account to disconnect done itself when the grant was not revoked or never kept', () => {
    for (const apple of ['not_revoked', 'none'] as const) {
      const notice = deletedNotice(true, apple)!
      expect(notice.text).toContain('disconnect done yourself in your Apple Account')
      expect(notice.text).not.toMatch(/may|might/)
      expect(notice.help).toBe(APPLE_DISCONNECT_HELP)
    }
  })

  it('says nothing about Apple for an account that never signed in with it', () => {
    for (const apple of ['revoked', 'not_revoked', 'none'] as const) expect(deletedNotice(false, apple)).toBeNull()
  })

  it('reads the server’s answer, and an older server’s silence as not revoked', () => {
    expect(appleAfterDeletion({ apple: 'revoked' })).toBe('revoked')
    expect(appleAfterDeletion({ apple: 'none' })).toBe('none')
    expect(appleAfterDeletion({ apple: 'not_revoked' })).toBe('not_revoked')
    expect(appleAfterDeletion({})).toBe('not_revoked')
    expect(appleAfterDeletion(null)).toBe('not_revoked')
  })
})

// The deletion itself, in an app: the marks of #112/#124 stay as they were,
// and what the server said about Apple is kept for after the reload.
describe('deleting the account in an app', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function deleteAs(id: string, answer: unknown) {
    vi.resetModules()
    vi.stubEnv('VITE_DONE_CLOUD_URL', 'https://example.test')
    const values = new Map([['done-cloud-session', JSON.stringify({ token: 't', account: { id, email: 'a@example.test' } })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
    vi.stubGlobal('location', { reload: vi.fn() })
    const invoke = vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => null)
    vi.stubGlobal('window', { __TAURI__: { core: { invoke }, event: { listen: async () => () => {} } } })
    vi.stubGlobal('fetch', async () => Response.json(answer))
    const { deleteAccount } = await import('@/lib/backend')
    await deleteAccount()
    const marks = invoke.mock.calls.filter(([c]) => c === 'mark_leaving').map(([, a]) => (a as { how: string }).how)
    expect(marks).toEqual(['deleting', 'deleted'])
    expect(values.has('done-cloud-session')).toBe(false)
    const { noticeAfterDeletion } = await import('@/lib/apple-after-deletion')
    return noticeAfterDeletion()
  }

  it('revoked: says done disconnected Sign in with Apple', async () => {
    expect((await deleteAs('appleba78', { apple: 'revoked' }))?.text).toBe('Your account was deleted, and done disconnected Sign in with Apple.')
  })

  it('not revoked: says the person must disconnect done, with Apple’s instructions', async () => {
    expect((await deleteAs('appleba78', { apple: 'not_revoked' }))?.help).toBe(APPLE_DISCONNECT_HELP)
  })

  it('no grant kept, or an older server: the same instruction', async () => {
    expect((await deleteAs('appleba78', { apple: 'none' }))?.help).toBe(APPLE_DISCONNECT_HELP)
    expect((await deleteAs('appleba78', {}))?.help).toBe(APPLE_DISCONNECT_HELP)
  })

  it('a Google account: nothing about Apple', async () => {
    expect(await deleteAs('1002', { apple: 'none' })).toBeNull()
  })
})
