import { describe, expect, it } from 'vitest'
import { byNewest, groupByDate, isBlank, keepLineBreaks, matches, titleOf } from './notes'

describe('titleOf', () => {
  it('is the first line with something on it, trimmed', () => {
    expect(titleOf('\n  Seed funds  \nAlpha Ventures\nBeta Capital')).toBe('Seed funds')
  })
  it('leaves out the Markdown that makes the line a heading', () => {
    expect(titleOf('# Seed funds\n- Alpha')).toBe('Seed funds')
    expect(titleOf('### Funds ###')).toBe('Funds')
    expect(titleOf('#\n## Real title')).toBe('Real title')
    expect(titleOf('#hashtag stays')).toBe('#hashtag stays')
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

describe('matches', () => {
  const note = { id: 1, text: 'Seed round funds\nAlpha Ventures\nFjörd Capital', updatedAt: 0 }
  it('finds a word anywhere in the note, ignoring case and accents', () => {
    expect(matches(note, 'alpha')).toBe(true)
    expect(matches(note, 'FJORD')).toBe(true)
  })
  it('needs every word', () => {
    expect(matches(note, 'seed alpha')).toBe(true)
    expect(matches(note, 'seed omega')).toBe(false)
  })
  it('matches everything when empty', () => {
    expect(matches(note, '  ')).toBe(true)
  })
})

describe('groupByDate', () => {
  const now = new Date(2026, 10, 21, 15, 0).getTime()
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime()
  const notes = [
    { id: 1, text: 'two years ago', updatedAt: at(2024, 4, 2) },
    { id: 2, text: 'today', updatedAt: at(2026, 10, 21, 1) },
    { id: 3, text: 'yesterday', updatedAt: at(2026, 10, 20, 23) },
    { id: 4, text: 'three days', updatedAt: at(2026, 10, 18) },
    { id: 5, text: 'twenty days', updatedAt: at(2026, 10, 1) },
    { id: 6, text: 'last month', updatedAt: at(2026, 8, 30) },
  ]
  it('puts each note under its heading, newest first, without empty headings', () => {
    expect(groupByDate(notes, now).map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ['Today', [2]],
      ['Yesterday', [3]],
      ['Previous 7 Days', [4]],
      ['Previous 30 Days', [5]],
      ['September', [6]],
      ['2024', [1]],
    ])
  })
})

describe('keepLineBreaks', () => {
  it('turns a single new line into a break, and leaves paragraphs, code and tables alone', () => {
    expect(keepLineBreaks('Funds\nSequoia\nBenchmark\n\nNext')).toBe('Funds\\\nSequoia\\\nBenchmark\n\nNext')
    expect(keepLineBreaks('```\na\nb\n```')).toBe('```\na\nb\n```')
    expect(keepLineBreaks('| a | b |\n| - | - |\n| 1 | 2 |')).toBe('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(keepLineBreaks('1. Sequoia\n2. Benchmark\n- a\n- b')).toBe('1. Sequoia\n2. Benchmark\n- a\n- b')
    expect(keepLineBreaks('# Title\n*20 Nov*\nPlan only')).toBe('# Title\n*20 Nov*\\\nPlan only')
  })
})
