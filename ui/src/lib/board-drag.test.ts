import { describe, expect, it } from 'vitest'
import { EDGE, MAX_STEP, edgeStep } from '@/lib/board-drag'

describe('edgeStep', () => {
  it('does not scroll in the middle of a column', () => {
    expect(edgeStep(300, 100, 600)).toBe(0)
    expect(edgeStep(100 + EDGE, 100, 600)).toBe(0)
    expect(edgeStep(600 - EDGE, 100, 600)).toBe(0)
  })

  it('scrolls toward the edge the finger is near, faster the closer', () => {
    expect(edgeStep(590, 100, 600)).toBeGreaterThan(0)
    expect(edgeStep(110, 100, 600)).toBeLessThan(0)
    expect(edgeStep(598, 100, 600)).toBeGreaterThan(edgeStep(580, 100, 600))
  })

  it('goes at full speed at or past the edge', () => {
    expect(edgeStep(600, 100, 600)).toBe(MAX_STEP)
    expect(edgeStep(700, 100, 600)).toBe(MAX_STEP)
    expect(edgeStep(50, 100, 600)).toBe(-MAX_STEP)
  })

  it('scrolls toward the nearer edge in a box too small to have a middle', () => {
    expect(edgeStep(110, 100, 140)).toBeLessThan(0)
    expect(edgeStep(130, 100, 140)).toBeGreaterThan(0)
  })
})
