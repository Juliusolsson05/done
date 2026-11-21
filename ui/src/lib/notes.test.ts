import { describe, expect, it } from 'vitest'
import { byNewest, isBlank, titleOf } from './notes'

describe('titleOf', () => {
  it('is the first line with something on it, trimmed', () => {
    expect(titleOf('\n  Seed funds  \nAlpha Ventures\nBeta Capital')).toBe('Seed funds')
  })
  it('is "New note" for a note with nothing in it', () => {
    expect(titleOf('')).toBe('New note')
    expect(titleOf(' \n \n')).toBe('New note')
  })
})

describe('notes order', () => {
  it('puts the most recently changed first', () => {
    const notes = [
      { id: 1, text: 'a', updatedAt: 10 },
      { id: 2, text: 'b', updatedAt: 30 },
      { id: 3, text: 'c', updatedAt: 20 },
    ]
    expect([...notes].sort(byNewest).map((n) => n.id)).toEqual([2, 3, 1])
  })
  it('counts only whitespace as blank', () => {
    expect(isBlank(' \n')).toBe(true)
    expect(isBlank(' x')).toBe(false)
  })
})
