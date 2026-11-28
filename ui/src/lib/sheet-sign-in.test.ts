import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

// An app built knowing a hosted server, with storage that works and a server
// that answers the exchange with `status`.
const app = async (status = 200) => {
  vi.stubEnv('VITE_DONE_CLOUD_URL', 'https://example.test')
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
  const session = { token: 'token', account: { id: 'google', email: 'me@example.test', name: '', picture: '' } }
  const fetched = vi.fn(async (_url: string, _init: { body: string }) => new Response(JSON.stringify(session), { status }))
  vi.stubGlobal('fetch', fetched)
  return { cloud: await import('@/lib/cloud'), fetched }
}

describe('which way an app signs in with Google', () => {
  const ways = () => ({
    openBrowser: vi.fn(async (_url: string) => undefined),
    presentSheet: vi.fn(async (_url: string) => ({ link: 'done://auth?code=abc' })),
  })

  // Why: sending an iPhone to Safari to sign in is what App Review rejected
  // (guideline 4.0). This fails if the phone is routed to the browser again.
  it('keeps an iPhone or iPad in the app: the sheet, never the browser', async () => {
    const { cloud } = await app()
    const { openBrowser, presentSheet } = ways()
    expect(await cloud.signInFromApp({ ios: true, openBrowser, presentSheet })).toBe(true)
    expect(presentSheet).toHaveBeenCalledOnce()
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('opens the browser on a Mac or PC and is not signed in until the link comes back', async () => {
    const { cloud, fetched } = await app()
    const { openBrowser, presentSheet } = ways()
    expect(await cloud.signInFromApp({ ios: false, openBrowser, presentSheet })).toBe(false)
    expect(openBrowser).toHaveBeenCalledOnce()
    expect(presentSheet).not.toHaveBeenCalled()
    expect(fetched).not.toHaveBeenCalled()
    openBrowser.mockRejectedValueOnce('no browser')
    await expect(cloud.signInFromApp({ ios: false, openBrowser, presentSheet })).rejects.toThrow('Your browser could not be opened.')
  })

  it("shows only the hosted server's sign-in page in the sheet", async () => {
    const { cloud } = await app()
    expect(cloud.isSignInPage('https://example.test/auth/google?app_challenge=abc')).toBe(true)
    expect(cloud.isSignInPage('https://example.test.evil.example/auth/google?app_challenge=abc')).toBe(false)
    expect(cloud.isSignInPage('https://example.test/elsewhere?app_challenge=abc')).toBe(false)
    expect(cloud.isSignInPage('https://evil.example/?https://example.test/auth/google?')).toBe(false)
  })

  // Why: two sign-ins under way share one stored secret, so the first sheet's
  // answer would be refused after the person had finished with Google.
  it('answers a second tap with the sign-in already under way, on the phone, in the sheet', async () => {
    await app()
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    let close: (answer: { link: string }) => void = () => {
      throw new Error('No sheet is up')
    }
    const invoke = vi.fn((_command: string, _args?: Record<string, unknown>) => new Promise<unknown>((resolve) => (close = resolve)))
    vi.stubGlobal('window', { __TAURI__: { core: { invoke }, event: { listen: async () => () => {} } } })
    const { signIn } = await import('@/lib/backend')
    const first = signIn()
    expect(signIn()).toBe(first)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    expect(invoke.mock.calls[0][0]).toBe('web_sign_in')
    close({ link: 'done://auth?code=abc' })
    await first
    expect(reload).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledOnce()
    expect(signIn()).not.toBe(first)
  })
})

describe('signing in with Google inside the iPhone app', () => {
  // Why the pairing matters: the server only gives a session to the app that
  // holds the secret behind the challenge the sheet was opened with.
  it('trades the link the sheet gives back for a session, with the secret behind the challenge it opened', async () => {
    const { cloud, fetched } = await app()
    let opened = ''
    const signedIn = await cloud.signInInSheet(async (url) => {
      opened = url
      return { link: 'done://auth?code=abc' }
    })
    expect(signedIn).toBe(true)
    const challenge = opened.replace('https://example.test/auth/google?app_challenge=', '')
    expect(challenge).toMatch(/^[0-9a-f]{64}$/)
    expect(fetched).toHaveBeenCalledOnce()
    const [url, init] = fetched.mock.calls[0]
    expect(url).toBe('https://example.test/auth/exchange')
    const sent = JSON.parse(init.body) as { code: string; verifier: string }
    expect(sent.code).toBe('abc')
    expect(await cloud.challengeOf(sent.verifier)).toBe(challenge)
    expect(cloud.cloudSession()?.token).toBe('token')
  })

  it('stays signed out and says nothing when the person closes the sheet', async () => {
    const { cloud, fetched } = await app()
    expect(await cloud.signInInSheet(async () => ({ error: 'cancelled' }))).toBe(false)
    expect(fetched).not.toHaveBeenCalled()
    expect(cloud.cloudSession()).toBeNull()
  })

  it('says so when the sheet fails, gives back no usable link, or the server refuses the code', async () => {
    const { cloud } = await app()
    await expect(cloud.signInInSheet(async () => ({ error: 'The network connection was lost.' }))).rejects.toThrow('Signing in did not work')
    await expect(cloud.signInInSheet(async () => ({ link: 'done://elsewhere?code=abc' }))).rejects.toThrow('Signing in did not work')
    vi.resetModules()
    const refused = await app(400)
    await expect(refused.cloud.signInInSheet(async () => ({ link: 'done://auth?code=abc' }))).rejects.toThrow('Signing in did not work')
    expect(refused.cloud.cloudSession()).toBeNull()
  })
})
