import { describe, expect, it } from 'vitest'
import { applySafeArea, insetsFor } from '@/lib/safe-area'

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
    expect(Object.fromEntries(values)).toEqual({ '--native-safe-top': '0px', '--native-safe-right': '62px', '--native-safe-bottom': '21px', '--native-safe-left': '62px' })
  })
  it('clears every side when the app has no answer', () => {
    const { values, el } = fake()
    applySafeArea(el, [59, 0, 34, 0])
    applySafeArea(el, null)
    expect(values.size).toBe(0)
  })
})

// #70, measured on the iPhone 17 simulator held sideways: the window reports
// the portrait insets; the island's strip must end up on both sides.
describe('insetsFor', () => {
  const phone = (width: number, height: number) => ({ width, height, iPhone: true })
  it('moves the island strip to both sides on a sideways iPhone', () => {
    expect(insetsFor([62, 0, 34, 0], phone(874, 402))).toEqual([0, 62, 21, 62])
  })
  it('keeps portrait and real landscape values as reported', () => {
    expect(insetsFor([62, 0, 34, 0], phone(402, 874))).toEqual([62, 0, 34, 0])
    expect(insetsFor([0, 62, 21, 62], phone(874, 402))).toEqual([0, 62, 21, 62])
  })
  it('leaves an iPad alone in landscape', () => {
    expect(insetsFor([24, 0, 20, 0], { width: 1180, height: 820, iPhone: false })).toEqual([24, 0, 20, 0])
  })
})
