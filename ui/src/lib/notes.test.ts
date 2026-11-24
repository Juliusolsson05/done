import { describe, expect, it } from 'vitest'
import { byNewest, cleanFolder, folderList, groupByDate, inFolder, isBlank, keepLineBreaks, matches, snippetOf, titleOf, withFolder, type Note } from './notes'

describe('titleOf', () => {
  it('reads a mentioned task as its words, not the link around it', () => {
    expect(titleOf('# [Call the bank](done:task/1795306779859023) this week\nMore')).toBe('Call the bank this week')
  })

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

describe('snippetOf', () => {
  it('is the first line with words after the title, read without its Markdown', () => {
    expect(snippetOf('# Plan\n\n- [ ] **Call** [the bank](done:task/12) about ~~it~~ *now*')).toBe('Call the bank about it now')
    expect(snippetOf('Plan\n## Week 48\nmore')).toBe('Week 48')
    expect(snippetOf('Plan\n1. See [site](https://example.com)')).toBe('See site')
  })
  it('is empty when the note is only a title', () => {
    expect(snippetOf('# Plan')).toBe('')
    expect(snippetOf('# Plan\n#\n')).toBe('')
    expect(snippetOf('')).toBe('')
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

describe('folders', () => {
  const note = (id: number, folder: string | null = null): Note => ({ id, text: 'Note ' + id, updatedAt: id, folder })

  it('keeps a name the way the tasks file does', () => {
    expect(cleanFolder('  Fund   raising ')).toBe('Fund raising')
    expect(cleanFolder('   ')).toBeNull()
    expect([...(cleanFolder('x'.repeat(80)) ?? '')].length).toBe(60)
  })

  it('lists each folder once whatever its case, counts its notes, and keeps an empty one made here', () => {
    const notes = [note(1, 'Ideas'), note(2, 'ideas'), note(3, 'Work'), note(4)]
    expect(folderList(notes, ['Recipes', 'WORK'])).toEqual([
      { name: 'Ideas', count: 2 },
      { name: 'Recipes', count: 0 },
      { name: 'Work', count: 1 },
    ])
  })

  it('lists every note under All notes and only its own in a folder', () => {
    expect(inFolder(note(1), null)).toBe(true)
    expect(inFolder(note(1, 'Ideas'), 'IDEAS')).toBe(true)
    expect(inFolder(note(1), 'Ideas')).toBe(false)
  })

  // Renaming and deleting a folder write only the notes in it.
  it('moves only the notes in a folder, to a new name or out of any folder', () => {
    const notes = [note(1, 'Ideas'), note(2, 'Work'), note(3, 'ideas'), note(4)]
    expect(withFolder(notes, 'Ideas', 'Plans').map((n) => [n.id, n.folder])).toEqual([
      [1, 'Plans'],
      [3, 'Plans'],
    ])
    expect(withFolder(notes, 'Work', null).map((n) => [n.id, n.folder])).toEqual([[2, null]])
  })
})
