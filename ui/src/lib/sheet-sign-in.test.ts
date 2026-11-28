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
