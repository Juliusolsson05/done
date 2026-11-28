import { describe, expect, it } from 'vitest'
import { appleSession, challengeOf, codeIn, sameAppleSession } from '@/lib/cloud'

describe('signing in from an app', () => {
  // Why the exact form matters: the server makes the same hash of the secret
  // and compares the two as text. Any other form and nobody can sign in.
  it('gives the server the SHA-256 of its secret, in lowercase hex', async () => {
    expect(await challengeOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('binds the native subject only to its server-verified Apple account', async () => {
    const account = { id: 'appleba7816bf8f01cfea414140de5dae2223b00361a3', email: '', name: '', picture: '' }
    const session = { account, token: 'first' }
    const bound = await appleSession(session, 'abc')
    expect(bound.appleUser).toBe('abc')
    await expect(appleSession(session, 'another')).rejects.toThrow('Choose the Apple Account')
    await expect(appleSession({ ...session, account: { ...account, id: 'google' } }, 'abc')).rejects.toThrow()
    expect(sameAppleSession(bound, bound)).toBe(true)
    expect(sameAppleSession({ ...bound, token: 'next' }, bound)).toBe(false)
    expect(sameAppleSession({ ...bound, appleUser: 'another' }, bound)).toBe(false)
    expect(sameAppleSession({ ...bound, account: { ...account, id: 'review' } }, bound)).toBe(false)
    expect(sameAppleSession(null, bound)).toBe(false)
    expect(sameAppleSession(session, session)).toBe(false)
  })

  it('reads the code out of the link the browser hands back', () => {
    expect(codeIn('done://auth?code=abc%2B123')).toBe('abc+123')
    expect(codeIn('done://auth/?code=xyz')).toBe('xyz')
  })

  it('takes nothing from any other link', () => {
    expect(codeIn('done://auth')).toBeNull()
    expect(codeIn('done://something-else?code=abc')).toBeNull()
    expect(codeIn('https://example.com/auth?code=abc')).toBeNull()
    expect(codeIn('not a link')).toBeNull()
  })
})
