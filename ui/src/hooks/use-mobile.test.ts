import { describe, expect, it } from 'vitest'
import { layoutFor } from '@/hooks/use-mobile'

// The device sizes the mobile audit measured, in points.
describe('layoutFor', () => {
  it('gives an iPhone the phone layout both ways up', () => {
    expect(layoutFor(402, 874, true)).toBe('phone')
    expect(layoutFor(874, 402, true)).toBe('phone')
    // The largest iPhone sideways, and the smallest.
    expect(layoutFor(956, 440, true)).toBe('phone')
    expect(layoutFor(667, 375, true)).toBe('phone')
  })

  it('gives an iPad the tablet layout both ways up', () => {
    expect(layoutFor(820, 1180, true)).toBe('tablet')
    expect(layoutFor(1180, 820, true)).toBe('tablet')
    // An iPad mini, and a large iPad Pro.
    expect(layoutFor(744, 1133, true)).toBe('phone')
    expect(layoutFor(1366, 1024, true)).toBe('tablet')
  })

  it('keeps the Mac split exactly at 768 wide', () => {
    expect(layoutFor(1440, 900, false)).toBe('desktop')
    expect(layoutFor(768, 400, false)).toBe('desktop')
    expect(layoutFor(767, 900, false)).toBe('phone')
  })

  it('treats an iPad in a narrow split view as a phone', () => {
    expect(layoutFor(320, 1180, true)).toBe('phone')
    expect(layoutFor(507, 820, true)).toBe('phone')
  })
})
