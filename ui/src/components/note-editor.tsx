// The note being written: CodeMirror, holding the note's Markdown as plain
// text, as the textarea before it did. Every note is written here. A note in
// a workspace is also bound to its live document (lib/collab.ts), so
// everyone in it types into the same text and sees each other's cursors.
//
// What it keeps from the textarea: the @ task picker (inserting a plain
// Markdown link, see lib/mentions), Cmd-click to open an address, undo with
// Cmd+Z (including from the Mac app's own Undo menu), growing with the text
// so the page scrolls rather than a box inside it, and the cursor in a new note.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { history, historyKeymap, defaultKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { MentionPicker } from '@/components/task-mention'
import { openLink } from '@/lib/backend'
import { linkAt } from '@/lib/links'
import { atQuery, insertMention, suggestions } from '@/lib/mentions'
import type { Task } from '@/lib/tasks'

export interface LiveBinding {
  text: Y.Text
  awareness: Awareness
  undo: Y.UndoManager
}

// Markdown shown as written, with only the quietest help for the eye:
// headings set apart, emphasis and links a shade lighter.
const QUIET = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--muted-foreground)' },
  { tag: [tags.processingInstruction, tags.meta, tags.monospace], color: 'var(--muted-foreground)' },
])

// The page's type and rhythm, not an editor's: it should read as the note.
const LOOK = EditorView.theme({
  '&': { fontSize: 'inherit', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': { padding: '0 0 6rem', caretColor: 'var(--foreground)', minHeight: '50svh' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--faint)' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)', borderLeftWidth: '1.5px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(30 79 191 / 0.16) !important' },
  // Someone else's cursor and name, in their colour (y-codemirror.next draws them).
  '.cm-ySelectionInfo': {
    fontFamily: 'inherit',
    fontSize: '10.5px',
    fontWeight: '600',
    padding: '1px 5px',
    borderRadius: '4px 4px 4px 0',
    top: '-1.35em',
    opacity: '1',
  },
  '.cm-ySelectionCaret': { borderLeftWidth: '2px' },
})

interface Picker {
  offered: Task[]
  chosen: number
  at: { start: number; query: string } | null
}

export function NoteEditor({
  text,
  onChange,
  focused,
  tasks,
  live,
  readOnly = false,
  onActivity,
}: {
  // The note's text. Only read when the editor is made, and when it changes
  // from outside (another device's save arriving) while nothing is being typed.
  text: string
  onChange: (text: string) => void
  focused: boolean
  // The tasks the @ picker offers.
  tasks: Task[]
  // A workspace note's live document. Without it the note is this window's alone.
  live?: LiveBinding
  readOnly?: boolean
  // Told when something is done in the note (typing, the cursor, the
  // pointer), so the others see you as active.
  onActivity?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [picker, setPicker] = useState<Picker>({ offered: [], chosen: 0, at: null })
  // Read by the editor's handlers, which are set up once.
  const latest = useRef({ picker, onChange, tasks, dismissed: null as number | null })
  latest.current.picker = picker
  latest.current.onChange = onChange
  latest.current.tasks = tasks
  const activity = useRef(onActivity)
  activity.current = onActivity
  const editable = useRef(new Compartment())

  // What the @ before the caret asks for, worked out after every change or move.
  const lookAt = (v: EditorView) => {
    const sel = v.state.selection.main
    const doc = v.state.doc.toString()
    const at = v.hasFocus && sel.empty ? atQuery(doc, sel.head) : null
    // Esc closes the list for that one @; once the @ is gone, a new one opens it again.
    if (at === null) latest.current.dismissed = null
    const open = at !== null && at.start !== latest.current.dismissed
    const offered = open ? suggestions(latest.current.tasks, at.query) : []
    setPicker((was) => ({ offered, at: open ? at : null, chosen: was.at?.query === at?.query ? was.chosen : 0 }))
  }

  const pick = (task: Task) => {
    const v = view.current
    const at = latest.current.picker.at
    if (!v || !at) return
    const doc = v.state.doc.toString()
    const caret = v.state.selection.main.head
    const next = insertMention(doc, at.start, caret, task)
    const inserted = next.text.slice(at.start, next.text.length - (doc.length - caret))
    // One change through the editor: Cmd+Z takes it back like any typing.
    v.dispatch({ changes: { from: at.start, to: caret, insert: inserted }, selection: { anchor: next.caret }, userEvent: 'input.complete' })
    v.focus()
  }

  useLayoutEffect(() => {
    if (!host.current) return
    const pickerKeys = Prec.highest(
      keymap.of([
        { key: 'ArrowDown', run: () => step(1) },
        { key: 'ArrowUp', run: () => step(-1) },
        { key: 'Enter', run: () => choose() },
        { key: 'Tab', run: () => choose() },
        {
          key: 'Escape',
          run: () => {
            const { picker } = latest.current
            if (!picker.offered.length || !picker.at) return false
            latest.current.dismissed = picker.at.start
            setPicker({ offered: [], chosen: 0, at: null })
            return true
          },
        },
      ]),
    )
    function step(by: number) {
      const { picker } = latest.current
      if (!picker.offered.length) return false
      setPicker({ ...picker, chosen: (picker.chosen + by + picker.offered.length) % picker.offered.length })
      return true
    }
    function choose() {
      const { picker } = latest.current
      if (!picker.offered.length) return false
      pick(picker.offered[Math.min(picker.chosen, picker.offered.length - 1)])
      return true
    }
    const undoKeys: Extension = live ? keymap.of(yUndoManagerKeymap) : [history(), keymap.of(historyKeymap)]
    const state = EditorState.create({
      doc: live ? live.text.toString() : text,
      extensions: [
        pickerKeys,
        undoKeys,
        keymap.of([...defaultKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(QUIET),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Note', 'data-findable': 'true', spellcheck: 'true', autocapitalize: 'sentences' }),
        placeholderText('Write it down… Type @ to add a task.'),
        LOOK,
        editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        live ? yCollab(live.text, live.awareness, { undoManager: live.undo }) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          // Only what you did, not the others' typing arriving.
          if (update.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('select') || t.isUserEvent('move'))) activity.current?.()
          if (update.docChanged || update.selectionSet || update.focusChanged) lookAt(update.view)
        }),
        EditorView.domEventHandlers({
          pointermove() {
            activity.current?.()
            return false
          },
          // Cmd-click on an address opens it, as in a code editor; a plain
          // click places the cursor as usual.
          mousedown(event, v) {
            if (!(event.metaKey || event.ctrlKey)) return false
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
            const href = pos === null ? null : linkAt(v.state.doc.toString(), pos)
            if (!href) return false
            event.preventDefault()
            openLink(href)
            return true
          },
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    // Undo and redo, taken before anything else on the page sees them: in the
    // Mac app's web view a key with Cmd can be lost to the app's menus.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const redoing = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)
      if (key !== 'z' && !redoing) return
      event.preventDefault()
      event.stopPropagation()
      if (live) {
        if (redoing) live.undo.redo()
        else live.undo.undo()
      } else if (redoing) redo(v)
      else undo(v)
    }
    v.dom.addEventListener('keydown', onKey, true)
    if (focused) {
      v.focus()
      v.dispatch({ selection: { anchor: v.state.doc.length } })
    }
    return () => {
      v.dom.removeEventListener('keydown', onKey, true)
      v.destroy()
      view.current = null
    }
    // Made once per note (the parent keys it by note) and per live binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  // Another device's save, arriving while this note is open and not being
  // written in: shown, without becoming a step Cmd+Z would undo. A live note
  // is kept by its document instead.
  useEffect(() => {
    const v = view.current
    if (!v || live || v.hasFocus) return
    const now = v.state.doc.toString()
    if (now === text) return
    v.dispatch({ changes: { from: 0, to: now.length, insert: text }, userEvent: 'sync' })
  }, [text, live])

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) })
  }, [readOnly])

  // Just under the line with the @, kept inside the note's width.
  const v = view.current
  let point: { top: number; left: number } | null = null
  if (v && picker.at && picker.offered.length && host.current) {
    const coords = v.coordsAtPos(picker.at.start)
    const box = host.current.getBoundingClientRect()
    if (coords) point = { top: coords.bottom - box.top + 2, left: Math.max(0, Math.min(coords.left - box.left, box.width - 320)) }
  }

  return (
    <div className="relative" aria-expanded={picker.offered.length > 0}>
      <div ref={host} className="w-full max-w-[68ch] text-[16px] leading-7 max-md:text-[17px]" />
      {point && (
        <MentionPicker
          tasks={picker.offered}
          chosen={Math.min(picker.chosen, picker.offered.length - 1)}
          at={point}
          onPick={pick}
          onHover={(chosen) => setPicker((p) => ({ ...p, chosen }))}
        />
      )}
    </div>
  )
}
