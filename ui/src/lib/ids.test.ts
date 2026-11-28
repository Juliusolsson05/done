import { describe, expect, it } from 'vitest'
import { newId } from '@/lib/ids'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  it('uses randomUUID where the page has it', () => {
    expect(newId({ randomUUID: () => '11111111-2222-4333-8444-555555555555' })).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('makes the same shape of id without it, as on a plain-http address', () => {
    const insecure = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    const ids = Array.from({ length: 50 }, () => newId(insecure))
    for (const id of ids) expect(id).toMatch(UUID)
    expect(new Set(ids).size).toBe(50)
  })

  it('still makes one with no crypto at all', () => {
    expect(newId({})).toMatch(UUID)
  })
})
