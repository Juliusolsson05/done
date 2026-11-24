import { describe, expect, it } from 'vitest'
import { applySafeArea } from '@/lib/safe-area'

// #70: the native insets reach the styles side by side, in the order the app
// sends them, and a missing answer leaves env() alone (no stale value).
describe('applySafeArea', () => {
  const fake = () => {
    const values = new Map<string, string>()
    return {
      values,
      el: { style: { setProperty: (k: string, v: string) => values.set(k, v), removeProperty: (k: string) => values.delete(k) } } as unknown as HTMLElement,
    }
  }
  it('sets top, right, bottom, left in that order', () => {
    const { values, el } = fake()
    applySafeArea(el, [0, 62, 21, 62])
    expect(Object.fromEntries(values)).toEqual({ '--native-safe-right': '62px', '--native-safe-bottom': '21px', '--native-safe-left': '62px' })
  })
  it('clears every side when the app has no answer', () => {
    const { values, el } = fake()
    applySafeArea(el, [59, 0, 34, 0])
    applySafeArea(el, null)
    expect(values.size).toBe(0)
  })
})
