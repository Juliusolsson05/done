import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('ends only the watched Apple session, takes shared workspaces off the device and clears its widgets', async () => {
  vi.stubEnv('VITE_DONE_CLOUD_URL', 'https://example.test')
  const session = { token: 'first', appleUser: 'subject', account: { id: 'apple-id', email: 'me@example.test' } }
  const values = new Map([['done-cloud-session', JSON.stringify(session)]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => undefined)
  const stop = vi.fn()
  let report: (event: { payload: string }) => void = () => { throw new Error('No active listener') }
  vi.stubGlobal('window', { __TAURI__: {
    core: { invoke },
    event: { listen: async (_event: string, handler: typeof report) => { report = handler; return stop } },
  } })
  const { watchAppleSession } = await import('@/lib/backend')
  const dispose = watchAppleSession()
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('watch_apple_user', { user: 'subject', id: expect.any(String) }))
  const id = invoke.mock.calls[0][1].id as string
  report({ payload: 'older-watch' })
  expect(values.has('done-cloud-session')).toBe(true)
  values.set('done-cloud-session', JSON.stringify({ ...session, token: 'replacement' }))
  report({ payload: id })
  expect(reload).not.toHaveBeenCalled()
  values.set('done-cloud-session', JSON.stringify(session))
  report({ payload: id })
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(values.has('done-cloud-session')).toBe(false)
  // No last round and no question: Apple ended the credential. The person's
  // own tasks stay (crates/core/src/account.rs `leave_account`).
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['watch_apple_user', 'leave_account', 'widget_snapshot'])
  expect(invoke).toHaveBeenCalledWith('leave_account', { deleted: false })
  dispose?.()
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
})
