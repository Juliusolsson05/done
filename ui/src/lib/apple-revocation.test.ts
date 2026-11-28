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
  // Nobody chose this, so it is a session that ended: unsent changes stay.
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['watch_apple_user', 'mark_leaving', 'finish_leaving', 'widget_snapshot'])
  expect(invoke).toHaveBeenCalledWith('mark_leaving', expect.objectContaining({ how: 'ended' }))
  dispose?.()
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
})

// Issue #120, D: the app hands the end to the window's own sign-out
// (lib/leave.ts), which also ends a focus session on a workspace task.
it('lets the window sign out when Apple ends the credential', async () => {
  vi.stubEnv('VITE_DONE_CLOUD_URL', 'https://example.test')
  const session = { token: 'first', appleUser: 'subject', account: { id: 'apple-id', email: 'me@example.test' } }
  const values = new Map([['done-cloud-session', JSON.stringify(session)]])
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
  vi.stubGlobal('location', { reload: vi.fn() })
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => undefined)
  let report: (event: { payload: string }) => void = () => {}
  vi.stubGlobal('window', { __TAURI__: { core: { invoke }, event: { listen: async (_e: string, handler: typeof report) => { report = handler; return () => {} } } } })
  const { watchAppleSession } = await import('@/lib/backend')
  const ended = vi.fn(async () => {})
  watchAppleSession(ended)
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('watch_apple_user', { user: 'subject', id: expect.any(String) }))
  report({ payload: invoke.mock.calls[0][1].id as string })
  await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce())
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['watch_apple_user'])
})

it('sends the sheet’s one-time code with its identity token and keeps only the Done session on the phone', async () => {
  vi.stubEnv('VITE_DONE_CLOUD_URL', 'https://example.test')
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
  vi.stubGlobal('location', { reload: vi.fn() })
  const credential = { token: 'apple-identity', code: 'one-use-code', user: 'abc', name: 'Ana' }
  vi.stubGlobal('window', { __TAURI__: { core: { invoke: async () => credential } } })
  const session = { token: 'done-session', account: { id: 'appleba7816bf8f01cfea414140de5dae2223b00361a3', email: 'ana@example.test' } }
  const fetch = vi.fn(async () => Response.json(session))
  vi.stubGlobal('fetch', fetch)
  const { signInWithApple } = await import('@/lib/backend')
  await expect(signInWithApple()).resolves.toBe(true)
  expect(fetch).toHaveBeenCalledWith('https://example.test/auth/apple', expect.objectContaining({
    body: JSON.stringify({ identity_token: credential.token, authorization_code: credential.code, name: credential.name }),
  }))
  expect(JSON.parse(values.get('done-cloud-session')!)).toEqual({ ...session, appleUser: 'abc' })
})
