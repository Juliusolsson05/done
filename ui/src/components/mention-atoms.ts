// In the note editor, a task mention ([Call the bank](done:task/12)) is
// drawn as "@Call the bank", and a link to another note
// ([Plan](done:note/34)) as a note icon and that note's title: each one piece
// that the cursor steps over and that Backspace or Delete takes whole. The
// note's text keeps the full link, so everything that reads notes (the read
// view, sync, agents) is unchanged.
import { RangeSetBuilder, StateEffect } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { mentionRanges } from '@/lib/mentions'

class Mention extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  eq(other: Mention) {
    return other.label === this.label
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-mention'
    span.textContent = '@' + this.label
    span.title = this.label
    return span
  }
  // The text under it is not for the browser to edit piece by piece.
  ignoreEvent() {
    return false
  }
}

// What the editor needs to know about the notes it links to. Read when the
// chips are drawn, so it is a function: the notes change while the editor
// lives (a rename, a deletion) and the editor is made only once.
export interface LinkedNotes {
  // The note's title now, or null when there is no such note.
  title(id: number): string | null
  open(id: number): void
}

// Sent when the notes changed, so the chips are drawn again with the titles
// as they are now. The document itself did not change.
export const notesChanged = StateEffect.define<null>()

// lucide's file-text, the read view's note icon.
const NOTE_ICON =
  '<svg viewBox="0 0 24 24" width="0.95em" height="0.95em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>'

class NoteChip extends WidgetType {
  // `title` is null for a note that is gone: the label stored in the link,
  // the words it was written with, is shown instead.
  constructor(
    readonly id: number,
    readonly label: string,
    readonly title: string | null,
    readonly open: (id: number) => void,
  ) {
    super()
  }
  eq(other: NoteChip) {
    return other.id === this.id && other.label === this.label && other.title === this.title
  }
  toDOM() {
    const chip = document.createElement('span')
    const missing = this.title === null
    chip.className = 'cm-note-link' + (missing ? ' cm-note-link-missing' : '')
    chip.dataset.noteLink = String(this.id)
    chip.innerHTML = NOTE_ICON
    chip.append(this.title ?? this.label)
    chip.title = missing ? 'This note is missing: it was deleted' : this.title!
    if (missing) return chip
    chip.setAttribute('role', 'link')
    // A tap opens the note and nothing else: the caret is not moved and, on
    // a touch screen, the keyboard does not come up. Taken at touchend
    // unless the finger moved (the page being scrolled), as a checklist
    // circle's tap is (components/live-preview).
    let start: { x: number; y: number } | null = null
    chip.addEventListener('touchstart', (event) => {
      const touch = event.touches[0]
      start = touch ? { x: touch.clientX, y: touch.clientY } : null
    }, { passive: true })
    chip.addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0]
      const still = start && touch && Math.abs(touch.clientX - start.x) < 10 && Math.abs(touch.clientY - start.y) < 10
      start = null
      if (!still) return
      event.preventDefault()
      this.open(this.id)
    }, { passive: false })
    chip.addEventListener('mousedown', (event) => event.preventDefault())
    chip.addEventListener('click', (event) => {
      event.preventDefault()
      this.open(this.id)
    })
    return chip
  }
  // Its own clicks and taps, handled above.
  ignoreEvent() {
    return true
  }
}

function draw(view: EditorView, notes: () => LinkedNotes): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const linked = notes()
  // The whole note, not only what is on screen: a code fence opened above
  // the screen still makes the links below it text. A note is short enough.
  for (const r of mentionRanges(view.state.doc.toString())) {
    const widget = r.kind === 'note' ? new NoteChip(r.id, r.label, linked.title(r.id), linked.open) : new Mention(r.label)
    builder.add(r.from, r.to, Decoration.replace({ widget }))
  }
  return builder.finish()
}

function atoms(notes: () => LinkedNotes) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = draw(view, notes)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(notesChanged))))
          this.decorations = draw(update.view, notes)
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      // Whole: the cursor jumps over it and a deletion takes all of it.
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    },
  )
}

const look = EditorView.baseTheme({
  '.cm-mention': {
    color: 'var(--primary)',
    backgroundColor: 'rgb(30 79 191 / 0.08)',
    borderRadius: '4px',
    padding: '0 3px',
    fontWeight: '500',
  },
  '.cm-note-link': {
    color: 'var(--primary)',
    backgroundColor: 'rgb(30 79 191 / 0.08)',
    borderRadius: '4px',
    padding: '0 4px 0 3px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  '.cm-note-link svg': { display: 'inline-block', verticalAlign: '-0.12em', marginRight: '3px' },
  '.cm-note-link-missing': {
    color: 'var(--muted-foreground)',
    backgroundColor: 'var(--muted)',
    textDecoration: 'line-through',
    cursor: 'default',
  },
})

export const mentionAtoms = (notes: () => LinkedNotes) => [atoms(notes), look]
