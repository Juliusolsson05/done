import { describe, expect, it } from 'vitest'
import { occurrences, step } from '@/lib/find'

describe('occurrences', () => {
  it('finds every place, case ignored, without overlaps', () => {
    expect(occurrences('Seed round: seed SEED', 'seed')).toEqual([
      [0, 4],
      [12, 16],
      [17, 21],
    ])
    expect(occurrences('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ])
  })
  it('finds nothing for an empty query', () => {
    expect(occurrences('anything', '  ')).toEqual([])
  })
})

describe('step', () => {
  it('wraps around both ways', () => {
    expect(step(2, 3, 1)).toBe(0)
    expect(step(0, 3, -1)).toBe(2)
    expect(step(0, 0, 1)).toBe(0)
  })
})
