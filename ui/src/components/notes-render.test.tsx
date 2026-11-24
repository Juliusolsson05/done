// A note with mentions, drawn through the very Markdown options the Notes
// page uses. Guards the promise of lib/mentions: a mention changes how its
// own link is drawn and nothing else in the note.
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'markdown-to-jsx/react'
import { describe, expect, it, vi } from 'vitest'

// The page's modules read `window` when they load (which backend to talk
// to); a plain object is enough for drawing to a string.
vi.hoisted(() => {
  Object.assign(globalThis, { window: globalThis })
})
import { MARKDOWN } from '@/components/notes'
import { NoteLinksContext, type NoteLinks } from '@/components/note-link'
import { AppContext, type App } from '@/lib/app-context'
import { toggleExpanded } from '@/lib/expanded'
import type { Task } from '@/lib/tasks'

const BANK = 1795306779859023
const DESCRIPTION = 'Ask about the loan terms, the fixed rate and when the first payment is due.\nBring last year’s statement.'
const tasks: Task[] = [
  { id: BANK, title: 'Call the bank (renamed)', notes: DESCRIPTION, projectId: null, start: null, due: '2026-11-27', priority: 1 },
  { id: 10, title: 'Find the account number', notes: '', projectId: null, start: null, due: null, priority: 4, parentId: BANK },
  {
    id: 11,
    title: 'Book a time',
    notes: '',
    projectId: null,
    start: null,
    due: null,
    priority: 4,
    parentId: BANK,
    done: true,
    doneDay: '2026-11-23',
  },
  { id: 2, title: 'Ship sync', notes: '', projectId: null, start: null, due: null, priority: 4, done: true, doneDay: '2026-11-23' },
]
// Only what a mention reads from the app.
const app = { data: { rev: 1, nextId: 3, projects: [], tasks }, complete() {}, reopen() {}, reveal() {} } as unknown as App

const draw = (text: string) =>
  renderToStaticMarkup(
    <AppContext.Provider value={app}>
      <Markdown options={MARKDOWN}>{text}</Markdown>
    </AppContext.Provider>,
  )

describe('a note with mentions', () => {
  const note = [
    '# Next week',
    '## Milestones',
    `- [Call the bank](done:task/${BANK}) before **Friday**`,
    '- [Ship sync](done:task/2)',
    '- A plain point with a [web link](https://example.com)',
    '',
    'Code stays code: `[x](done:task/2)`',
  ].join('\n')
  const html = draw(note)

  it('draws each mention as its task, with the title as it is now and its state', () => {
    expect(html).toContain(`data-mention="${BANK}"`)
    expect(html).toContain('Call the bank (renamed)')
    expect(html).toMatch(/data-mention="2"[\s\S]*?aria-checked="true"/)
  })

  it('leaves the Markdown around them as it was', () => {
    expect(html).toMatch(/<h1[^>]*>Next week<\/h1>/)
    expect(html).toMatch(/<h2[^>]*>Milestones<\/h2>/)
    expect(html.match(/<li>/g)).toHaveLength(3)
    expect(html).toContain('<strong>Friday</strong>')
    expect(html).toMatch(/<a href="https:\/\/example.com"[^>]*>web link<\/a>/)
    expect(html).toContain('<code>[x](done:task/2)</code>')
  })

  it('shows a mention of a task no one has as the words it was written with', () => {
    // Not in the window; the lookup in the Completed list happens later, in the browser.
    expect(draw('[Old task](done:task/999)')).toContain('Old task')
  })

  it('shows the whole description, every line of it', () => {
    expect(draw(`[Call the bank](done:task/${BANK})`)).toContain(DESCRIPTION)
  })

  it('holds a long description to three lines, so the card never buries the note', () => {
    const html = draw(`[Call the bank](done:task/${BANK})`)
    expect(html).toMatch(/<span[^>]*class="[^"]*line-clamp-3[^"]*"[^>]*>Ask about the loan terms/)
  })

  it('shows the subtasks, each with its own check, once they are opened', () => {
    const closed = draw(`[Call the bank](done:task/${BANK})`)
    expect(closed).toContain('1/2')
    expect(closed).not.toContain('Find the account number')
    toggleExpanded(BANK)
    const opened = draw(`[Call the bank](done:task/${BANK})`)
    expect(opened).toContain('Find the account number')
    expect(opened).toMatch(/data-task="11"[\s\S]*?aria-checked="true"/)
    expect(opened).toMatch(/data-task="10"[\s\S]*?aria-checked="false"/)
    toggleExpanded(BANK)
  })
})

describe('a note linking another note', () => {
  const PLAN = 1795306779859111
  // The linked note as it is now: renamed since the link was written.
  const notes = [
    { id: PLAN, text: '# Seed round plan (v2)\nDetails', updatedAt: 1 },
    { id: 7, text: '  \n', updatedAt: 2 },
  ]
  const links: NoteLinks = { notes, offered: notes, open() {}, linkedFrom: () => [] }
  const drawLinked = (text: string) =>
    renderToStaticMarkup(
      <AppContext.Provider value={app}>
        <NoteLinksContext.Provider value={links}>
          <Markdown options={MARKDOWN}>{text}</Markdown>
        </NoteLinksContext.Provider>
      </AppContext.Provider>,
    )

  it('draws the link as a chip with the linked note’s title as it is now', () => {
    const html = drawLinked(`See [Seed round plan](done:note/${PLAN}) first`)
    expect(html).toMatch(new RegExp(`<button[^>]*data-note-link="${PLAN}"`))
    expect(html).toContain('Seed round plan (v2)')
    expect(html).not.toContain('href="done:note')
  })

  it('shows a note emptied of its words as New note, still to be opened, not as missing', () => {
    const html = drawLinked('See [Draft](done:note/7)')
    expect(html).toMatch(/<button[^>]*data-note-link="7"/)
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('missing')
    expect(html).toContain('New note')
  })

  it('shows a link to a note that is gone as the words it was written with, marked missing', () => {
    const html = drawLinked('See [Old plan](done:note/42)')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="This note is missing[^"]*"/)
    expect(html).toContain('Old plan')
  })
})
