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
import { AppContext, type App } from '@/lib/app-context'
import type { Task } from '@/lib/tasks'

const BANK = 1795306779859023
const tasks: Task[] = [
  { id: BANK, title: 'Call the bank (renamed)', notes: '', projectId: null, start: null, due: '2026-11-27', priority: 1 },
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
})
