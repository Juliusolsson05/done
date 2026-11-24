import { describe, expect, it } from 'vitest'
import { isIosAgent } from '@/lib/platform'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
// What an iPad's web view says: the same as a Mac's.
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

describe('isIosAgent', () => {
  it('knows an iPhone, and an iPad that calls itself a Mac', () => {
    expect(isIosAgent(IPHONE, 5)).toBe(true)
    expect(isIosAgent(MAC, 5)).toBe(true)
  })

  it('knows a Mac, which has no touch screen', () => {
    expect(isIosAgent(MAC, 0)).toBe(false)
  })
})
