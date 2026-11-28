import { history, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { previewRanges } from './live-preview'
import { bulletedList, continueList, indentList, numberedList, outdentList } from './note-list'

function editor(doc: string, anchor = doc.length, head = anchor) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [history(), markdown({ base: markdownLanguage })] })
  return {
    run: (command: StateCommand) =>
      command({
        state,
        dispatch: (tr: Transaction) => {
          state = tr.state
        },
      }),
    text: () => state.doc.toString(),
    caret: () => state.selection.main.head,
    levels: () =>
      previewRanges(state, new Set())
        .lines.filter((line) => line.depth)
        .map((line) => line.depth),
    numbers: () =>
      previewRanges(state, new Set())
        .hides.filter((marker) => marker.kind === 'number')
        .map((marker) => marker.label),
  }
}

describe('writing an outline', () => {
  it('continues, nests, and returns to the parent with the caret after its number', () => {
    const e = editor('1. Parent')
    e.run(continueList)
    expect(e.text()).toBe('1. Parent\n2. ')
    e.run(indentList)
    expect(e.text()).toBe('1. Parent\n   1. ')
    expect(e.levels()).toEqual([1, 2])
    expect(e.caret()).toBe(e.text().length)
    e.run(continueList)
    expect(e.text()).toBe('1. Parent\n2. ')
    e.run(continueList)
    expect(e.text()).toBe('1. Parent\n')
  })

  it('moves children and continuation text as one undoable edit under a two-digit parent', () => {
    const doc = '10. Parent\n11. Move\n    continued\n    - Child\n12. Next'
    const e = editor(doc, doc.indexOf('ove'))
    e.run(indentList)
    expect(e.text()).toBe('10. Parent\n    1. Move\n       continued\n       - Child\n11. Next')
    expect(e.text().slice(e.caret(), e.caret() + 3)).toBe('ove')
    expect(e.levels()).toEqual([1, 2, 3, 1])
    expect(e.run(undo)).toBe(true)
    expect(e.text()).toBe(doc)
  })

  it('moves selected siblings together, joins existing children and renumbers on lifting', () => {
    const doc = '1. A\n   1. B\n2. C\n3. D\n4. E'
    const e = editor(doc, doc.indexOf('C'), doc.indexOf('D') + 1)
    e.run(indentList)
    expect(e.text()).toBe('1. A\n   1. B\n   2. C\n   3. D\n2. E')
    e.run(outdentList)
    expect(e.text()).toBe(doc)
  })

  it('nests a numbered point under a bullet and keeps mixed children intact', () => {
    const doc = '- Parent\n1. Child\n   - Grandchild'
    const e = editor(doc, doc.indexOf('Child'))
    e.run(indentList)
    expect(e.text()).toBe('- Parent\n  1. Child\n     - Grandchild')
    expect(e.levels()).toEqual([1, 2, 3])
  })

  it('lifts from the middle without changing the written order', () => {
    const doc = '8. Parent\n   1. Child\n   2. Next\n9. Last'
    const e = editor(doc, doc.indexOf('Child'))
    e.run(outdentList)
    expect(e.text()).toBe('8. Parent\n9. Child\n   1. Next\n10. Last')
    expect(e.levels()).toEqual([1, 1, 2, 1])
  })

  it('keeps the rendered ordinal while typing words and reveals its source inside the marker', () => {
    const doc = '1. Parent\n   1. Child\n   1. Another'
    const cursor = (pos: number) => {
      const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: markdown({ base: markdownLanguage }) })
      return previewRanges(state, new Set([3])).hides.map((hide) => hide.label)
    }
    expect(cursor(doc.length)).toEqual(['1.', '1.', '2.'])
    expect(cursor(doc.lastIndexOf('.'))).toEqual(['1.', '1.'])
  })

  it('converts parent markers without changing the nesting of children or paragraphs', () => {
    const doc = '- Parent\n  continuation\n  - Child\n    - Grandchild\n- Next'
    const e = editor(doc, doc.indexOf('Parent'))
    e.run(numberedList)
    expect(e.text()).toBe('1. Parent\n   continuation\n   - Child\n     - Grandchild\n- Next')
    expect(e.levels()).toEqual([1, 2, 3, 1])
    e.run(bulletedList)
    expect(e.text()).toBe(doc)
    const multi = editor('10. Parent\n    - Nested', 5)
    multi.run(bulletedList)
    expect(multi.text()).toBe('- Parent\n  - Nested')
    expect(multi.levels()).toEqual([1, 2])
  })

  it('formats only the covered lines when a selection ends at the next line start', () => {
    const doc = '- Parent\n  - Child\n- Next'
    const e = editor(doc, 0, doc.indexOf('- Next'))
    e.run(numberedList)
    expect(e.text()).toBe('1. Parent\n   - Child\n- Next')
  })

  it('moves the containing item from a continuation but leaves code alone', () => {
    const doc = '1. Parent\n2. Child\n   continuation\n   - sub'
    const e = editor(doc, doc.indexOf('tinuation'))
    expect(e.run(indentList)).toBe(true)
    expect(e.text()).toBe('1. Parent\n   1. Child\n      continuation\n      - sub')
    expect(e.run(outdentList)).toBe(true)
    expect(e.text()).toBe(doc)
    const code = '1. Parent\n2. Child\n   ```\n   1. literal\n   ```'
    const inside = editor(code, code.indexOf('literal'))
    expect(inside.run(indentList)).toBe(false)
    expect(inside.run(numberedList)).toBe(false)
    expect(inside.text()).toBe(code)
  })

  it('renders the sequence from the first number of each list even when pasted markers repeat', () => {
    const doc = '8) A\n   1. B\n   1. C\n1) D'
    const e = editor(doc)
    expect(e.numbers()).toEqual(['8)', '1.', '2.', '9)'])
    expect(e.text()).toBe(doc)
  })

  it('leaves prose, fenced examples and a first item alone', () => {
    for (const doc of ['paragraph', '1. first', '```\n1. A\n2. B\n```']) {
      const e = editor(doc, doc.indexOf('B') >= 0 ? doc.indexOf('B') : doc.length)
      expect(e.run(indentList)).toBe(false)
      expect(e.run(outdentList)).toBe(false)
      expect(e.text()).toBe(doc)
    }
  })
})
