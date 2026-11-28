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
  const invoke = vi.fn(async (command: string) => {
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
  expect(invoke).toHaveBeenCalledWith('mark_leaving', { how: 'ended' })
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
  expect(invoke.mock.calls[0]).toEqual(['mark_leaving', { how: 'deleted' }])
  // Asked after the mark; the 401's own "ended" mark is weaker (core keeps
  // "deleted"), and the mark is not taken back.
  expect(asked).toEqual(['1:https://example.test/api/account/delete'])
  expect(invoke).not.toHaveBeenCalledWith('mark_leaving', { how: null })
})

it('takes the mark back when the server refuses the deletion', async () => {
  const session = { token: 't', account: { id: '1002', email: 'geart@hop.dev' } }
  const { invoke, values } = app(session)
  vi.stubGlobal('fetch', async () => new Response('{"error":"down"}', { status: 500 }))
  const { deleteAccount } = await import('@/lib/backend')
  await expect(deleteAccount()).rejects.toThrow('down')
  expect(invoke).toHaveBeenLastCalledWith('mark_leaving', { how: null })
  expect(values.has('done-cloud-session')).toBe(true)
})
