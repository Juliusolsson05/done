// The note editor's live preview, as text in and ranges out: which Markdown
// markers are hidden on lines the cursor is not on, and the small edits the
// keyboard bar and the checklist circle make.
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import {
  cycleHeading,
  dateLine,
  keyboardInset,
  minimalChange,
  notesLayout,
  previewRanges,
  taskToggle,
  toggleBold,
  toggleBullet,
  toggleChecklist,
} from '@/lib/live-preview'

const stateOf = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

// What each hidden range covers, as text, with its kind.
const hidden = (doc: string, active: number[] = []) => {
  const state = stateOf(doc)
  return previewRanges(state, new Set(active)).hides.map((h) => `${h.kind}:${doc.slice(h.from, h.to)}`)
}

describe('live preview: what is hidden', () => {
  it('hides a heading marker on a line the cursor is not on', () => {
    expect(hidden('# Plan\nBody')).toEqual(['hide:# '])
    expect(hidden('Title\n## Milestones')).toEqual(['hide:## '])
  })

  it('shows every marker on the cursor’s line', () => {
    expect(hidden('# Plan\nBody', [1])).toEqual([])
    expect(hidden('Some **bold** and *it*', [1])).toEqual([])
  })

  it('hides emphasis, bold and strikethrough markers', () => {
    expect(hidden('T\nSome **bold**, *it* and ~~gone~~')).toEqual(['hide:**', 'hide:**', 'hide:*', 'hide:*', 'hide:~~', 'hide:~~'])
  })

  it('draws a bullet in place of a list dash and a circle in place of a checklist box', () => {
    expect(hidden('T\n- milk\n* eggs')).toEqual(['bullet:- ', 'bullet:* '])
    expect(hidden('T\n- [ ] milk\n- [x] eggs')).toEqual(['task:- [ ] ', 'task:- [x] '])
    const tasks = previewRanges(stateOf('T\n- [ ] milk\n- [x] eggs'), new Set()).hides
    expect(tasks.map((t) => t.checked)).toEqual([false, true])
  })

  it('keeps a number as a number, drawn in the margin', () => {
    expect(hidden('T\n1. first\n2. second')).toEqual(['number:1. ', 'number:2. '])
  })

  it('takes a nested item’s indentation into its marker', () => {
    const state = stateOf('T\n- top\n  - under')
    const { hides, lines } = previewRanges(state, new Set())
    expect(hides.map((h) => state.sliceDoc(h.from, h.to))).toEqual(['- ', '  - '])
    expect(lines.find((l) => l.line === 3)?.depth).toBe(2)
  })

  it('shows a web link as its words, and leaves a task mention or note link to its own widget', () => {
    expect(hidden('T\nSee [the site](https://example.com) now')).toEqual(['hide:[', 'hide:](https://example.com)'])
    expect(hidden('T\nCall [the bank](done:task/12) now')).toEqual([])
    expect(hidden('T\nSee [the plan](done:note/12) now')).toEqual([])
  })

  it('marks the first line as the title, headings by level, and ticked items as done', () => {
    const { lines } = previewRanges(stateOf('Plan\n## Week\n- [x] done\n- [ ] open'), new Set())
    expect(lines.find((l) => l.line === 1)?.classes).toContain('cm-title')
    expect(lines.find((l) => l.line === 2)?.classes).toContain('cm-h2')
    expect(lines.find((l) => l.line === 3)?.classes).toContain('cm-task-done')
    expect(lines.find((l) => l.line === 4)?.classes).not.toContain('cm-task-done')
  })

  it('draws an empty line short, except on the cursor’s line and as the title', () => {
    const blank = (doc: string, active: number[] = []) =>
      previewRanges(stateOf(doc), new Set(active)).lines.filter((l) => l.classes.includes('cm-blank')).map((l) => l.line)
    expect(blank('1. a\n\n2. b\n  \nend')).toEqual([2, 4])
    expect(blank('1. a\n\n2. b', [2])).toEqual([])
    expect(blank('\nbody')).toEqual([])
  })

  it('never hides across a line break', () => {
    const doc = '# A\n**b\nc**\n- x'
    const state = stateOf(doc)
    for (const h of previewRanges(state, new Set()).hides) expect(state.doc.lineAt(h.from).number).toBe(state.doc.lineAt(h.to).number)
  })
})

describe('edits from the circle and the keyboard bar', () => {
  it('ticks and unticks a checklist line', () => {
    expect(taskToggle('- [ ] milk')).toEqual({ at: 3, insert: 'x' })
    expect(taskToggle('  * [x] milk')).toEqual({ at: 5, insert: ' ' })
    expect(taskToggle('  - [X] milk')).toEqual({ at: 5, insert: ' ' })
    expect(taskToggle('milk [ ]')).toBeNull()
  })

  it('makes a line a checklist item, and back', () => {
    expect(toggleChecklist('milk')).toBe('- [ ] milk')
    expect(toggleChecklist('- milk')).toBe('- [ ] milk')
    expect(toggleChecklist('1. milk')).toBe('- [ ] milk')
    expect(toggleChecklist('  - [x] milk')).toBe('  milk')
    expect(toggleChecklist('# Title')).toBe('- [ ] Title')
  })

  it('makes a line a bullet, and back', () => {
    expect(toggleBullet('milk')).toBe('- milk')
    expect(toggleBullet('- milk')).toBe('milk')
    expect(toggleBullet('- [ ] milk')).toBe('- milk')
    expect(toggleBullet('  3. milk')).toBe('  - milk')
  })

  it('cycles a heading: none, #, ##, none', () => {
    expect(cycleHeading('Week')).toBe('# Week')
    expect(cycleHeading('# Week')).toBe('## Week')
    expect(cycleHeading('## Week')).toBe('Week')
    expect(cycleHeading('### Week')).toBe('Week')
    expect(cycleHeading('- item')).toBe('# item')
  })

  it('changes only what differs, so a live note sends the least', () => {
    expect(minimalChange('- [ ] milk', '- milk')).toEqual({ from: 2, to: 6, insert: '' })
    expect(minimalChange('milk', '- [ ] milk')).toEqual({ from: 0, to: 0, insert: '- [ ] ' })
    expect(minimalChange('same', 'same')).toBeNull()
  })

  it('makes the selection bold, or unbolds it, or opens a pair at the caret', () => {
    expect(toggleBold('a word here', 2, 6)).toEqual({ changes: [{ from: 2, insert: '**' }, { from: 6, insert: '**' }], anchor: 4, head: 8 })
    expect(toggleBold('a **word** here', 4, 8)).toEqual({ changes: [{ from: 2, to: 4, insert: '' }, { from: 8, to: 10, insert: '' }], anchor: 2, head: 6 })
    expect(toggleBold('ab', 1, 1)).toEqual({ changes: [{ from: 1, insert: '****' }], anchor: 3, head: 3 })
  })
})

describe('the note’s date and layout', () => {
  it('writes the date as Apple Notes does under the title', () => {
    expect(dateLine(new Date(2026, 10, 23, 22, 44).getTime())).toBe('23 November 2026 at 22:44')
    expect(dateLine(new Date(2026, 0, 5, 7, 3).getTime())).toBe('5 January 2026 at 07:03')
  })

  it('shows list and note side by side only when the note gets at least 420 points', () => {
    expect(notesLayout(1200)).toBe('split')
    expect(notesLayout(700)).toBe('split')
    expect(notesLayout(699)).toBe('stacked')
    // iPad portrait: 820 wide, less the sidebar and the page's margins.
    expect(notesLayout(468)).toBe('stacked')
  })

  it('knows how much of the screen the keyboard covers', () => {
    expect(keyboardInset(844, { offsetTop: 0, height: 844 })).toBe(0)
    expect(keyboardInset(844, { offsetTop: 0, height: 508 })).toBe(336)
    expect(keyboardInset(844, { offsetTop: 120, height: 508 })).toBe(216)
  })
})
