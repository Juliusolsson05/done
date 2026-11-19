import { describe, expect, it } from 'vitest'
import { readMe } from '@/lib/me'

describe('who the interface is talking to', () => {
  it('is nobody yet on the hosted server before signing in', () => {
    expect(readMe(200, { mode: 'cloud', account: null })).toEqual({
      mode: 'cloud',
      account: null,
    })
  })

  it('is the signed-in account on the hosted server', () => {
    const account = { email: 'anna@example.com', name: 'Anna', picture: '' }
    expect(readMe(200, { mode: 'cloud', account })).toEqual({
      mode: 'cloud',
      account,
    })
  })

  // Why anything unexpected counts as local: a server from before accounts
  // existed answers this call with "not found", and must not be met with a
  // sign-in screen it has no way to serve.
  it('has no accounts on a local server, or on one too old to know the question', () => {
    expect(readMe(200, { mode: 'local' })).toEqual({ mode: 'local' })
    expect(readMe(404, null)).toEqual({ mode: 'local' })
    expect(readMe(200, 'not what was asked for')).toEqual({ mode: 'local' })
  })
})
