import { afterEach, expect, it, vi } from 'vitest'

// Review of #112, 1: what an app does with its file when it is not signed in
// and when its session ends. The app's commands are stood in for.
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

function app(session: unknown) {
  vi.stubEnv('VITE_DONE_CLOUD_URL', 'https://example.test')
  const values = new Map(session ? [['done-cloud-session', JSON.stringify(session)]] : [])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  const order: string[] = []
  const invoke = vi.fn(async (command: string, _args?: unknown): Promise<unknown> => {
    order.push(command)
    if (command === 'outbox') return { upto: 1, renumbered: 0, rows: {} }
    if (command === 'state') return { rev: 0, nextId: 1, projects: [], tasks: [] }
    return null
  })
  vi.stubGlobal('window', { __TAURI__: { core: { invoke }, event: { listen: async () => () => {} } } })
  return { values, reload, invoke, order }
}

it('changes nothing in the file when a window that is not signed in loads', async () => {
  // The "done next" preview app: never signed in, on the real tasks file.
  const { invoke, order } = app(null)
  const { loadState } = await import('@/lib/backend')
  await loadState('2026-11-27')
  await loadState('2026-11-27')
  // Only a leaving that was marked is finished, and only once per window.
  expect(order).toEqual(['finish_leaving', 'state', 'state'])
  expect(invoke).not.toHaveBeenCalledWith('leave_account', expect.anything())
})

it('marks a session that ended before forgetting it, so unsent changes are kept', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { values, reload, invoke, order } = app(session)
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
  const { replicate } = await import('@/lib/backend')
  await expect(replicate()).rejects.toThrow('signed out')
  expect(invoke).toHaveBeenCalledWith('mark_leaving', expect.objectContaining({ how: 'ended' }))
  expect(order).toEqual(['outbox', 'mark_leaving'])
  expect(values.has('done-cloud-session')).toBe(false)
  expect(reload).toHaveBeenCalledOnce()
})

// Review of #112, 5: the deletion is marked before the server is asked, so a
// round answered 401 meanwhile still ends in the deleted-account clean-up.
it('marks a deletion before asking the server, and keeps the mark through a 401', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke, order } = app(session)
  const asked: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(`${order.length}:${url}`)
    return new Response('{}', { status: 401 })
  })
  const { deleteAccount } = await import('@/lib/backend')
  await expect(deleteAccount()).rejects.toThrow('signed out')
  expect(order[0]).toBe('mark_leaving')
  expect(invoke.mock.calls[0]).toEqual(['mark_leaving', expect.objectContaining({ how: 'deleting' })])
  // Asked after the mark; the 401's own "ended" mark is weaker (core keeps
  // "deleted"), and the mark is not taken back.
  expect(asked).toEqual(['1:https://example.test/api/account/delete'])
  expect(invoke).not.toHaveBeenCalledWith('mark_leaving', expect.objectContaining({ how: null }))
})

it('takes the mark back when the server refuses the deletion', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke, values } = app(session)
  vi.stubGlobal('fetch', async () => new Response('{"error":"down"}', { status: 500 }))
  const { deleteAccount } = await import('@/lib/backend')
  await expect(deleteAccount()).rejects.toThrow('down')
  expect(invoke).toHaveBeenLastCalledWith('mark_leaving', expect.objectContaining({ how: null }))
  expect(values.has('done-cloud-session')).toBe(true)
})

// Issue #120, C: the mark taken back after a refused deletion is not
// swallowed when it fails, and a deletion is only marked as one once the
// server confirmed it.
it('tries again to take the mark back, and says when it cannot', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke } = app(session)
  let fails = 1
  invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === 'mark_leaving' && (args as { how: unknown }).how === null && fails-- > 0) throw new Error('busy')
    return null
  })
  vi.stubGlobal('fetch', async () => new Response('{"error":"down"}', { status: 500 }))
  const { deleteAccount } = await import('@/lib/backend')
  await expect(deleteAccount()).rejects.toThrow('down')
  expect(invoke.mock.calls.filter(([c, a]) => c === 'mark_leaving' && (a as { how: unknown }).how === null)).toHaveLength(2)
})

it('marks the deletion as one only once the server confirmed it', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke } = app(session)
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
  const { deleteAccount } = await import('@/lib/backend')
  await deleteAccount()
  const marks = invoke.mock.calls.filter(([c]) => c === 'mark_leaving').map(([, a]) => (a as { how: string }).how)
  expect(marks).toEqual(['deleting', 'deleted'])
})

// Issue #120, B: a mark is the app's that wrote it. A signed-out load
// finishes only its own; a signed-in app that finds its own completes it.
it('finishes only the marks this app wrote', async () => {
  const { invoke, values } = app(null)
  values.set('done-app-owner', 'done-next')
  const { loadState } = await import('@/lib/backend')
  await loadState('2026-11-27')
  expect(invoke).toHaveBeenCalledWith('finish_leaving', { by: 'done-next' })
})

it('marks with the id of this app', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke, values } = app(session)
  values.set('done-app-owner', 'real')
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
  const { replicate } = await import('@/lib/backend')
  await expect(replicate()).rejects.toThrow('signed out')
  expect(invoke).toHaveBeenCalledWith('mark_leaving', { how: 'ended', by: 'real' })
})

it('completes its own mark when a signed-in app starts', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke, values, reload, order } = app(session)
  values.set('done-app-owner', 'real')
  invoke.mockImplementation(async (command: string) => {
    order.push(command)
    return command === 'own_mark' ? 'signed-out' : null
  })
  const { loadState } = await import('@/lib/backend')
  void loadState('2026-11-27')
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(invoke).toHaveBeenCalledWith('own_mark', { by: 'real' })
  expect(order.slice(0, 2)).toEqual(['own_mark', 'finish_leaving'])
  expect(order).not.toContain('state')
  expect(values.has('done-cloud-session')).toBe(false)
})
