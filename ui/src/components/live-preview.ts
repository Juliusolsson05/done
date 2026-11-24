// The note editor's live preview, drawn: Markdown markers hidden on every
// line the cursor is not on (lib/live-preview decides which), list markers
// drawn in the margin as a bullet, a number or a checklist circle, the
// first line set as the note's title with its date under it, as in Apple
// Notes. Only drawing: the document is never changed by any of this, except
// by a tap on a checklist circle, which ticks it with an ordinary change (so
// a live note sends it to everyone, and Cmd+Z takes it back).
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { dateLine, previewRanges, taskToggle } from '@/lib/live-preview'

// ---------- Widgets ----------

class Bullet extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const mark = document.createElement('span')
    mark.className = 'cm-li-mark cm-bullet'
    mark.textContent = '•'
    return mark
  }
  ignoreEvent() {
    return false
  }
}

class NumberMark extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  eq(other: NumberMark) {
    return other.label === this.label
  }
  toDOM() {
    const mark = document.createElement('span')
    mark.className = 'cm-li-mark cm-number'
    mark.textContent = this.label
    return mark
  }
  ignoreEvent() {
    return false
  }
}

const CHECK =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>'

// Ticks or unticks the checklist item on the line at `pos`.
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  if (view.state.readOnly) return false
  const line = view.state.doc.lineAt(pos)
  const toggle = taskToggle(line.text)
  if (!toggle) return false
  const at = line.from + toggle.at
  view.dispatch({ changes: { from: at, to: at + 1, insert: toggle.insert }, userEvent: 'input.toggle' })
  return true
}

class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskBox) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const mark = document.createElement('span')
    mark.className = 'cm-li-mark cm-task-box'
    const circle = document.createElement('span')
    circle.className = 'cm-task-circle' + (this.checked ? ' cm-task-on' : '')
    if (this.checked) circle.innerHTML = CHECK
    mark.appendChild(circle)
    mark.setAttribute('role', 'checkbox')
    mark.setAttribute('aria-checked', String(this.checked))
    mark.setAttribute('aria-label', this.checked ? 'Ticked' : 'Not ticked')
    // A tap ticks it and nothing else: the keyboard does not come up, the
    // cursor stays where it was.
    mark.addEventListener('mousedown', (event) => event.preventDefault())
    mark.addEventListener('click', (event) => {
      event.preventDefault()
      toggleTaskAt(view, view.posAtDOM(mark))
    })
    return mark
  }
  ignoreEvent() {
    return true
  }
}

class NoteDate extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: NoteDate) {
    return other.text === this.text
  }
  toDOM() {
    const line = document.createElement('div')
    line.className = 'cm-note-date'
    line.textContent = this.text
    return line
  }
  ignoreEvent() {
    return true
  }
}

// ---------- The markers ----------

// The lines the selection is on, while the editor has focus. Unfocused, the
// whole note reads formatted.
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  if (!view.hasFocus) return lines
  const doc = view.state.doc
  for (const range of view.state.selection.ranges) {
    const last = doc.lineAt(range.to).number
    for (let n = doc.lineAt(range.from).number; n <= last; n++) lines.add(n)
  }
  return lines
}

function draw(view: EditorView): DecorationSet {
  const { hides, lines } = previewRanges(view.state, activeLines(view))
  const doc = view.state.doc
  const ranges = []
  for (const look of lines) {
    if (look.line > doc.lines) continue
    const attributes = look.depth ? { style: `--depth: ${look.depth}` } : undefined
    ranges.push(Decoration.line({ class: look.classes.join(' '), attributes }).range(doc.line(look.line).from))
  }
  for (const hide of hides) {
    const widget =
      hide.kind === 'bullet' ? new Bullet() : hide.kind === 'number' ? new NumberMark(hide.label ?? '') : hide.kind === 'task' ? new TaskBox(!!hide.checked) : undefined
    ranges.push(Decoration.replace({ widget }).range(hide.from, hide.to))
  }
  return Decoration.set(ranges, true)
}

const markers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = draw(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = draw(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

// ---------- The date under the title ----------

// The note's date, set from outside (the note's updatedAt). A block under
// the first line, so it is never part of the text.
export const setNoteDate = StateEffect.define<number | null>()

function dateDecorations(state: EditorState, at: number | null): DecorationSet {
  // A note with nothing in it yet shows only its placeholder.
  if (at === null || state.doc.length === 0) return Decoration.none
  return Decoration.set([Decoration.widget({ widget: new NoteDate(dateLine(at)), block: true, side: 1 }).range(state.doc.line(1).to)])
}

function dateField(initial: number | null) {
  return StateField.define<{ at: number | null; decorations: DecorationSet }>({
    create: (state) => ({ at: initial, decorations: dateDecorations(state, initial) }),
    update(value, tr) {
      let at = value.at
      for (const effect of tr.effects) if (effect.is(setNoteDate)) at = effect.value
      if (at === value.at && !tr.docChanged) return value
      // Only redrawn when what it says changes, or the title line moved.
      const same = at !== null && value.at !== null && dateLine(at) === dateLine(value.at)
      if (same && !tr.docChanged) return { at, decorations: value.decorations }
      return { at, decorations: dateDecorations(tr.state, at) }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
}

// ---------- The look ----------

// Apple Notes' metrics: title 28 bold with 8 below, a small grey date, body
// 17 (the editor's own size, set by the page) at 1.45 with 6 between lines,
// headings 22 and 19, lists hanging from their marker.
const look = EditorView.theme({
  '.cm-line.cm-title': { fontSize: '28px', lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.015em', paddingBottom: '8px' },
  '.cm-line.cm-title .cm-placeholder': { fontWeight: '700' },
  '.cm-note-date': { fontSize: '13px', lineHeight: '18px', color: 'var(--tertiary)', paddingBottom: '14px' },
  '.cm-line.cm-h1': { fontSize: '22px', lineHeight: '1.3', fontWeight: '700', paddingTop: '10px' },
  '.cm-line.cm-h2': { fontSize: '19px', lineHeight: '1.35', fontWeight: '650', paddingTop: '8px' },
  '.cm-line.cm-h3': { fontSize: 'inherit', fontWeight: '650', paddingTop: '6px' },
  // A list item hangs from its marker: wrapped lines start under the words,
  // not under the bullet. Deeper items step in.
  '.cm-line.cm-li': {
    paddingLeft: 'calc((var(--depth, 1) - 1) * 1.5em + 1.75em)',
    textIndent: '-1.75em',
  },
  '.cm-li-mark': {
    display: 'inline-flex',
    alignItems: 'center',
    width: '1.75em',
    height: '1.45em',
    verticalAlign: 'top',
    textIndent: '0',
    color: 'var(--muted-foreground)',
    userSelect: 'none',
  },
  '.cm-bullet': { paddingLeft: '0.35em', fontSize: '1.05em' },
  '.cm-number': { fontVariantNumeric: 'tabular-nums' },
  '.cm-task-box': { cursor: 'pointer', position: 'relative' },
  // A thumb is bigger than the circle.
  '.cm-task-box::after': { content: '""', position: 'absolute', inset: '-8px -4px -8px -10px' },
  '.cm-task-circle': {
    display: 'inline-flex',
    width: '1.2em',
    height: '1.2em',
    borderRadius: '9999px',
    border: '1.5px solid var(--faint)',
    color: 'var(--primary-foreground)',
    padding: '0.12em',
    boxSizing: 'border-box',
    transition: 'background-color 0.15s, border-color 0.15s',
  },
  '.cm-task-circle.cm-task-on': { backgroundColor: 'var(--done)', borderColor: 'var(--done)' },
  // Ticked: the item steps back, as in Apple Notes.
  '.cm-line.cm-task-done': { color: 'var(--tertiary)' },
})

// The live preview. `date` is the note's last change, shown under the title.
export function livePreview(date: number | null): Extension {
  return [markers, dateField(date), look]
}
