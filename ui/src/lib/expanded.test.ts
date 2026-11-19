import { describe, expect, it } from 'vitest'
import { toggled } from '@/lib/expanded'

describe('toggled', () => {
  it('opens a closed task and closes an open one, leaving the set it was given alone', () => {
    const open = new Set([1])
    expect([...toggled(open, 2)]).toEqual([1, 2])
    expect([...toggled(open, 1)]).toEqual([])
    expect([...open]).toEqual([1])
  })
})
