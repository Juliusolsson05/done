import { describe, expect, it } from 'vitest'
import { atQuery, insertMention, mentionDetails, mentionId, mentionLink, markInline, mentionRanges, mentionsIn, noteLink, noteLinkId, noteLinksIn, noteSuggestions, suggestions, withoutMentionSyntax } from '@/lib/mentions'
import type { Task } from '@/lib/tasks'

const task = (id: number, title: string, fields: Partial<Task> = {}): Task => ({
  id,
  title,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...fields,
})

// The ids are the size real ones are (time in milliseconds times 1000, plus a random part).
const BANK = 1795306779859023
const SYNC = 1795390229598378

describe('a mention', () => {
  it('is only the exact done:task/<digits> form', () => {
    expect(mentionId(`done:task/${BANK}`)).toBe(BANK)
    expect(mentionId('https://done.app/task/1')).toBeNull()
    expect(mentionId('done:task/12abc')).toBeNull()
    expect(mentionId('done:task/')).toBeNull()
    expect(mentionId('xdone:task/1')).toBeNull()
    expect(mentionId(undefined)).toBeNull()
  })

  it('survives a title with brackets and backslashes, and reads back as the title', () => {
    const awkward = task(7, 'Fix [urgent] path C:\\temp')
    const link = mentionLink(awkward)
    expect(link).toBe('[Fix \\[urgent\\] path C:\\\\temp](done:task/7)')
    expect(mentionsIn(`Do ${link} today`)).toEqual([7])
    expect(withoutMentionSyntax(link)).toBe('Fix [urgent] path C:\\temp')
  })
})

describe('the tasks a note mentions', () => {
  it('are listed in order, once each, wherever the Markdown puts them', () => {
    const note = [
      '# Next week',
      '## Goals',
      `- [Call the bank](done:task/${BANK}) by **Friday**`,
      `- [Improve sync](done:task/${SYNC})`,
      '| Milestone | Task |',
      '|---|---|',
      `| Ship | [Call the bank](done:task/${BANK}) |`,
    ].join('\n')
    expect(mentionsIn(note)).toEqual([BANK, SYNC])
  })

  // Code is shown as written, so a mention in it is text, as the Markdown parser draws it.
  it('leave out what is written inside code', () => {
    const note = ['Inline `[x](done:task/1)` stays text.', '```', '[y](done:task/2)', '```', '[z](done:task/3)'].join('\n')
    expect(mentionsIn(note)).toEqual([3])
    // A fence indented under a list item, and a span of two backticks, are code too.
    const nested = ['- Step', '  ```', '  [y](done:task/2)', '  ```', 'Double ``[x](done:task/1)`` span', '[z](done:task/3)'].join('\n')
    expect(mentionsIn(nested)).toEqual([3])
  })
})

describe('typing @', () => {
  it('asks for a task at the start of a line or after a space or bracket', () => {
    expect(atQuery('@ca', 3)).toEqual({ start: 0, query: 'ca' })
    expect(atQuery('Goals:\n- @call the', 18)).toEqual({ start: 9, query: 'call the' })
    expect(atQuery('(@sync', 6)).toEqual({ start: 1, query: 'sync' })
    expect(atQuery('Ask @', 5)).toEqual({ start: 4, query: '' })
  })

  it('does not for an email address, a finished mention, or a gap', () => {
    expect(atQuery('mail julius@done.app', 20)).toBeNull()
    expect(atQuery('@call  bank', 11)).toBeNull()
    expect(atQuery('@call\nnext', 10)).toBeNull()
    expect(atQuery('[Call](done:task/1) ', 20)).toBeNull()
  })

  it('follows the caret, and lets go once a sentence is being written', () => {
    const text = 'Before @sy and then we wrote on'
    expect(atQuery(text, 10)).toEqual({ start: 7, query: 'sy' })
    expect(atQuery(text, 31)).toBeNull()
  })

  it('is replaced by the mention, with the caret past one space', () => {
    const text = '- @call the\nNext line'
    const at = atQuery(text, 11)
    expect(at).not.toBeNull()
    const done = insertMention(text, at!.start, 11, mentionLink(task(BANK, 'Call the bank')))
    expect(done.text).toBe(`- [Call the bank](done:task/${BANK})\nNext line`)
    expect(done.text.slice(0, done.caret)).toBe(`- [Call the bank](done:task/${BANK})`)
    expect(insertMention('@x', 0, 2, mentionLink(task(1, 'A'))).text).toBe('[A](done:task/1) ')
    // At the end of a line the caret stays on that line (it used to jump to the next).
    const atEnd = insertMention('- @a\nnext', 2, 4, mentionLink(task(1, 'A')))
    expect(atEnd.text).toBe('- [A](done:task/1)\nnext')
    expect(atEnd.text.slice(atEnd.caret)).toBe('\nnext')
  })
})

describe('the tasks offered', () => {
  const tasks = [
    task(1, 'Reach out to the bank', { priority: 2 }),
    task(2, 'Bank statement', { priority: 4 }),
    task(3, 'Call the bank', { priority: 1 }),
    task(4, 'Bank holiday', { done: true, doneDay: '2026-11-20' }),
    task(5, 'Bank subtask', { parentId: 2 }),
    task(6, 'Plan the week', { due: '2026-11-24' }),
  ]

  it('put a title that starts with the words first, then a word that does, by priority', () => {
    expect(suggestions(tasks, 'bank').map((t) => t.id)).toEqual([2, 3, 1])
    expect(suggestions(tasks, 'call bank').map((t) => t.id)).toEqual([3])
  })

  it('leave out finished tasks and subtasks, and with nothing typed put the soonest due first', () => {
    expect(suggestions(tasks, '').map((t) => t.id)[0]).toBe(6)
    expect(suggestions(tasks, '').map((t) => t.id)).not.toContain(4)
    expect(suggestions(tasks, '').map((t) => t.id)).not.toContain(5)
  })
})

describe("a mentioned task's card", () => {
  const today = '2026-11-22'
  const projects = [{ id: 9, name: 'Catch Up' }]

  it('says where it lives, that it is late, its subtasks and that it is under way', () => {
    const promises = task(1, 'Keep the promises', {
      projectId: 9,
      due: '2026-11-18',
      status: 'doing',
      notes: '\nGo through sent mail and answer everyone who is still waiting on something from me',
    })
    const subtasks = [task(2, 'Anna', { parentId: 1, done: true, doneDay: today }), task(3, 'Ben', { parentId: 1 })]
    expect(mentionDetails(promises, [promises, ...subtasks], projects, today)).toEqual([
      { kind: 'project', id: 9, name: 'Catch Up' },
      { kind: 'when', text: 'Late · 18 Nov', late: true },
      { kind: 'subtasks', done: 1, total: 2 },
      { kind: 'doing' },
    ])
  })

  it('says a span from start to due, the Inbox, and only what it has', () => {
    const plain = task(4, 'Plan', { start: '2026-11-23', due: '2026-11-25' })
    expect(mentionDetails(plain, [plain], projects, today)).toEqual([
      { kind: 'project', id: null, name: 'Inbox' },
      { kind: 'when', text: 'Tomorrow – Wednesday', late: false },
    ])
  })

  it('says when a finished task was done, and not that it is late', () => {
    const finished = task(5, 'Ship', { due: '2026-11-01', done: true, doneDay: today, status: 'doing' })
    expect(mentionDetails(finished, [finished], projects, today)).toEqual([
      { kind: 'project', id: null, name: 'Inbox' },
      { kind: 'when', text: 'Done today', late: false },
    ])
  })

  it('finds each mention whole, for the editor to treat as one piece', () => {
    const text = 'Do [Call the bank](done:task/12) and [Pay \\[rent\\]](done:task/34) today'
    const ranges = mentionRanges(text)
    expect(ranges.map((r) => [r.id, r.label, text.slice(r.from, r.to)])).toEqual([
      [12, 'Call the bank', '[Call the bank](done:task/12)'],
      [34, 'Pay [rent]', '[Pay \\[rent\\]](done:task/34)'],
    ])
    expect(mentionRanges('[a web link](https://x.com)')).toEqual([])
  })

  it('uses the same card placement while writing and reading, without changing examples inside code', () => {
    const link = '[Call the bank](done:task/1)'
    const note = [link, '1. Plan', '   1. ' + link, '- [ ] ' + link + '.', 'Before ' + link, link + ' and ' + link, '`' + link + '`', '```md', link, '```'].join('\n')
    const ranges = mentionRanges(note)
    expect(ranges.map((r) => r.card)).toEqual([true, true, true, false, false, false])
    expect(ranges.map((r) => note.slice(r.from, r.to))).toEqual(ranges.map(() => link))
    const read = markInline(note)
    expect(read.match(/#inline/g)).toHaveLength(3)
    expect(read).toContain('`' + link + '`')
    expect(read).toContain('```md\n' + link + '\n```')
  })

  it('draws a mention alone on its line as a card, and one among words small', () => {
    const text = [
      '- [Call the bank](done:task/1)',
      '- [ ] [Call the bank](done:task/2).',
      'Julius: [Order equipment](done:task/3) (20 Nov)',
      '[A](done:task/4) and [B](done:task/5)',
      '```',
      'x [C](done:task/6) y',
      '```',
    ].join('\n')
    expect(markInline(text).split('\n')).toEqual([
      '- [Call the bank](done:task/1)',
      '- [ ] [Call the bank](done:task/2).',
      'Julius: [Order equipment](done:task/3#inline) (20 Nov)',
      '[A](done:task/4#inline) and [B](done:task/5#inline)',
      '```',
      'x [C](done:task/6) y',
      '```',
    ])
    expect(mentionId('done:task/3#inline')).toBe(3)
  })
})

describe('a link to another note', () => {
  const PLAN = 1795306779859111

  it('is only the exact done:note/<digits> form, and never a task', () => {
    expect(noteLinkId(`done:note/${PLAN}`)).toBe(PLAN)
    expect(noteLinkId(`done:task/${PLAN}`)).toBeNull()
    expect(mentionId(`done:note/${PLAN}`)).toBeNull()
    expect(noteLinkId('done:note/12abc')).toBeNull()
    expect(noteLinkId('https://done.app/note/1')).toBeNull()
  })

  it('escapes its label as a mention does, and reads back as the title', () => {
    const link = noteLink({ id: 7, title: 'Plan [draft] C:\\temp' })
    expect(link).toBe('[Plan \\[draft\\] C:\\\\temp](done:note/7)')
    expect(noteLinksIn(`See ${link}`)).toEqual([7])
    expect(withoutMentionSyntax(`See ${link}`)).toBe('See Plan [draft] C:\\temp')
  })

  it('is listed apart from the tasks, once each, and not inside code', () => {
    const note = ['[Bank](done:task/1) and [Plan](done:note/2)', '`[x](done:note/3)`', '```', '[y](done:note/4)', '```', '[Plan again](done:note/2) [Z](done:note/5)'].join('\n')
    expect(noteLinksIn(note)).toEqual([2, 5])
    expect(mentionsIn(note)).toEqual([1])
  })

  it('is text, not a piece, inside code, as the read view shows it; positions after code still hold', () => {
    const text = ['`[a](done:note/1)` then [Plan](done:note/2)', '```', '[b](done:note/3) [c](done:task/4)', '```', '[Bank `x`](done:task/5)'].join('\n')
    expect(mentionRanges(text).map((r) => [r.kind, r.id, r.label, text.slice(r.from, r.to)])).toEqual([
      ['note', 2, 'Plan', '[Plan](done:note/2)'],
      ['task', 5, 'Bank `x`', '[Bank `x`](done:task/5)'],
    ])
  })

  it('is one piece in the editor, told apart from a task mention', () => {
    const text = 'Do [Bank](done:task/1) after [Plan](done:note/2)'
    expect(mentionRanges(text).map((r) => [r.kind, r.id, r.label, text.slice(r.from, r.to)])).toEqual([
      ['task', 1, 'Bank', '[Bank](done:task/1)'],
      ['note', 2, 'Plan', '[Plan](done:note/2)'],
    ])
  })
})

describe('the notes offered after an @', () => {
  const note = (id: number, title: string, updatedAt: number, blank = false) => ({ id, title, updatedAt, blank })
  const notes = [
    note(1, 'Seed round plan', 10),
    note(2, 'Planning the offsite', 30),
    note(3, 'Meeting with Alpha: plan', 20),
    note(4, 'Groceries', 40),
    note(5, 'New note', 50, true),
  ]

  it('rank a title starting with the words, then a word starting with them, then any; newest first within', () => {
    expect(noteSuggestions(notes, 'plan', null, 5).map((n) => n.id)).toEqual([2, 3, 1])
    expect(noteSuggestions(notes, 'seed', null).map((n) => n.id)).toEqual([1])
  })

  it('are the newest when nothing is typed, never the note being written or a blank one', () => {
    expect(noteSuggestions(notes, '', 4).map((n) => n.id)).toEqual([2, 3, 1])
    expect(noteSuggestions(notes, '', null, 2).map((n) => n.id)).toEqual([4, 2])
  })
})

describe('the @ list matches as Cmd+K and the filter do', () => {
  it('ignores accents, in tasks and in notes', () => {
    const tasks = [task(1, 'Book the Café'), task(2, 'Cafeteria menu'), task(3, 'Call the bank')]
    expect(suggestions(tasks, 'cafe').map((t) => t.id).sort()).toEqual([1, 2])
    expect(suggestions(tasks, 'CAFÉ book').map((t) => t.id)).toEqual([1])
    const notes = [{ id: 1, title: 'Résumé draft', updatedAt: 1 }, { id: 2, title: 'Shopping', updatedAt: 2 }]
    expect(noteSuggestions(notes, 'resume', null).map((n) => n.id)).toEqual([1])
  })
})
