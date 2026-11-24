// The note being written: CodeMirror, holding the note's Markdown as plain
// text, as the textarea before it did. Every note is written here. A note in
// a workspace is also bound to its live document (lib/collab.ts), so
// everyone in it types into the same text and sees each other's cursors.
//
// What it keeps from the textarea: the @ picker of tasks and notes
// (inserting a plain Markdown link, see lib/mentions), Cmd-click to open an address, undo with
// Cmd+Z (including from the Mac app's own Undo menu), growing with the text
// so the page scrolls rather than a box inside it, and the cursor in a new note.
//
// It reads as Apple Notes does while you write (components/live-preview):
// the Markdown's markers are hidden on every line but the cursor's, the first
// line is the title with the date under it, and a checklist has circles to
// tap. On a touch screen a bar of writing tools sits above the keyboard
// (components/writing-bar).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { history, historyKeymap, defaultKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { MentionPicker } from '@/components/task-mention'
import { mentionAtoms, notesChanged, type LinkedNotes } from '@/components/mention-atoms'
import { linkedTitle, useNoteLinks } from '@/components/note-link'
import { livePreview, setNoteDate } from '@/components/live-preview'
import { BAR_HEIGHT, useCoarsePointer, useVisualViewport, WritingBar } from '@/components/writing-bar'
import { openLink } from '@/lib/backend'
import { linkAt } from '@/lib/links'
import { atQuery, insertMention, mentionLink, noteLink, noteSuggestions, suggestions, type Offer } from '@/lib/mentions'
import { isBlank, titleOf } from '@/lib/notes'
import type { Task } from '@/lib/tasks'

export interface LiveBinding {
  text: Y.Text
  awareness: Awareness
  undo: Y.UndoManager
}

// What the markers mean, drawn: bold, italic, struck through, a link's words
// in done's blue. (The markers themselves are hidden by the live preview.)
const QUIET = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--primary)' },
  { tag: tags.url, color: 'var(--muted-foreground)' },
  { tag: [tags.processingInstruction, tags.meta, tags.monospace], color: 'var(--muted-foreground)' },
])

// The page's type and rhythm, not an editor's: it should read as the note.
const LOOK = EditorView.theme({
  '&': { fontSize: 'inherit', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': { padding: '0 0 6rem', caretColor: 'var(--primary)', minHeight: '50svh' },
  // Each line of a note is a paragraph: a little air after each, as in Apple Notes.
  '.cm-line': { padding: '0 0 6px' },
  '.cm-placeholder': { color: 'var(--faint)' },
  '.cm-placeholder-hint': { display: 'block', fontSize: '1rem', fontWeight: '400', letterSpacing: '0', paddingTop: '10px' },
  '.cm-cursor': { borderLeftColor: 'var(--primary)', borderLeftWidth: '2px' },
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

// An empty note: where the title goes, and how to add a task.
function notePlaceholder(): HTMLElement {
  const wrap = document.createElement('span')
  wrap.textContent = 'New note'
  const hint = document.createElement('span')
  hint.className = 'cm-placeholder-hint'
  hint.textContent = 'Type @ to add a task or link a note.'
  wrap.appendChild(hint)
  return wrap
}

interface Picker {
  offered: Offer[]
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
  date = null,
  onActivity,
  id = null,
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
  // When the note was last changed, shown under its title.
  date?: number | null
  // Told when something is done in the note (typing, the cursor, the
  // pointer), so the others see you as active.
  onActivity?: () => void
  // The note being written, never offered as a link to itself.
  id?: number | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [picker, setPicker] = useState<Picker>({ offered: [], chosen: 0, at: null })
  // Read by the editor's handlers, which are set up once.
  const links = useNoteLinks()
  const latest = useRef({ picker, onChange, tasks, links, id, dismissed: null as number | null })
  latest.current.picker = picker
  latest.current.onChange = onChange
  latest.current.tasks = tasks
  latest.current.links = links
  latest.current.id = id
  // The linked notes as the chips read them, always the latest: the editor
  // is made once, the notes change under it.
  const linked = useRef<LinkedNotes>({
    title: (note) => linkedTitle(latest.current.links.notes, note),
    open: (note) => latest.current.links.open(note),
  })
  const activity = useRef(onActivity)
  activity.current = onActivity
  const editable = useRef(new Compartment())
  // Whether the note is being written in: the writing bar shows meanwhile.
  const [writing, setWriting] = useState(false)
  const coarse = useCoarsePointer()
  const barShown = coarse && writing && !readOnly
  // Kept clear when the caret is scrolled to: the bar above the keyboard,
  // and the note's own bar at the top of a phone.
  const margins = useRef({ top: 0, bottom: 0 })
  margins.current.bottom = barShown ? BAR_HEIGHT + 12 : 0
  const viewport = useVisualViewport(barShown, () => {
    // The keyboard came up or moved: the caret is kept in sight above it.
    const v = view.current
    if (v?.hasFocus) v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: 'nearest' }) })
  })

  // What the @ before the caret asks for, worked out after every change or move.
  const lookAt = (v: EditorView) => {
    const sel = v.state.selection.main
    const doc = v.state.doc.toString()
    const at = v.hasFocus && sel.empty ? atQuery(doc, sel.head) : null
    // Esc closes the list for that one @; once the @ is gone, a new one opens it again.
    if (at === null) latest.current.dismissed = null
    const open = at !== null && at.start !== latest.current.dismissed
    // A few notes, under the tasks, which keep the rest of the eight rows:
    // the list stays short above a phone's keyboard.
    const notes = open
      ? noteSuggestions(
          latest.current.links.notes.map((n) => ({ id: n.id, title: titleOf(n.text), updatedAt: n.updatedAt, blank: isBlank(n.text) })),
          at.query,
          latest.current.id,
        )
      : []
    const offered: Offer[] = open
      ? [
          ...suggestions(latest.current.tasks, at.query, 8 - notes.length).map((task) => ({ kind: 'task' as const, task })),
          ...notes.map((n) => ({ kind: 'note' as const, id: n.id, title: n.title })),
        ]
      : []
    setPicker((was) => ({ offered, at: open ? at : null, chosen: was.at?.query === at?.query ? was.chosen : 0 }))
  }

  const pick = (offer: Offer) => {
    const v = view.current
    const at = latest.current.picker.at
    if (!v || !at) return
    const doc = v.state.doc.toString()
    const caret = v.state.selection.main.head
    const next = insertMention(doc, at.start, caret, offer.kind === 'task' ? mentionLink(offer.task) : noteLink(offer))
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
        // GitHub's Markdown: checklists and strikethrough as well.
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(QUIET),
        livePreview(date),
        EditorView.scrollMargins.of(() => {
          const bar = document.querySelector('[data-note-bar]')?.getBoundingClientRect().bottom ?? 0
          return { top: Math.max(0, bar) + 8, bottom: margins.current.bottom }
        }),
        // A task mention is one piece, shown as @ and its title; a note
        // link likewise, as the linked note's title.
        mentionAtoms(() => linked.current),
        EditorView.lineWrapping,
        // Written as any text on an iPhone: corrected, capitalised, spelled
        // and suggested (CodeMirror turns all four off by default).
        EditorView.contentAttributes.of({
          'aria-label': 'Note',
          'data-findable': 'true',
          spellcheck: 'true',
          autocorrect: 'on',
          autocapitalize: 'sentences',
          writingsuggestions: 'true',
        }),
        placeholderText(notePlaceholder),
        LOOK,
        editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        live ? yCollab(live.text, live.awareness, { undoManager: live.undo }) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          // Only what you did, not the others' typing arriving.
          if (update.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('select') || t.isUserEvent('move'))) activity.current?.()
          if (update.docChanged || update.selectionSet || update.focusChanged) lookAt(update.view)
          if (update.focusChanged) setWriting(update.view.hasFocus)
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

  // A linked note renamed or deleted: its chip is drawn again.
  useEffect(() => {
    view.current?.dispatch({ effects: notesChanged.of(null) })
  }, [links.notes])

  // The date under the title follows the note's last change.
  useEffect(() => {
    view.current?.dispatch({ effects: setNoteDate.of(date) })
  }, [date])

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
      {/* Apple Notes' body: 17 on a touch screen, at 1.45. */}
      <div ref={host} className="w-full max-w-[68ch] text-[16px] leading-[1.45] max-md:text-[17px] pointer-coarse:text-[17px]" />
      {point && (
        <MentionPicker
          offers={picker.offered}
          chosen={Math.min(picker.chosen, picker.offered.length - 1)}
          at={point}
          onPick={pick}
          onHover={(chosen) => setPicker((p) => ({ ...p, chosen }))}
        />
      )}
      {barShown && v && <WritingBar view={v} viewport={viewport} />}
    </div>
  )
}
