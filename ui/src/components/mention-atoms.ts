// In the note editor, a task mention ([Call the bank](done:task/12)) is
// drawn as "@Call the bank": one piece that the cursor steps over and that
// Backspace or Delete takes whole. The note's text keeps the full link, so
// everything that reads notes (the read view, sync, agents) is unchanged.
import { RangeSetBuilder } from '@codemirror/state'
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

function draw(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (const r of mentionRanges(view.state.doc.sliceString(from, to))) {
      builder.add(from + r.from, from + r.to, Decoration.replace({ widget: new Mention(r.label) }))
    }
  }
  return builder.finish()
}

const atoms = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = draw(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = draw(update.view)
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Whole: the cursor jumps over it and a deletion takes all of it.
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
)

const look = EditorView.baseTheme({
  '.cm-mention': {
    color: 'var(--primary)',
    backgroundColor: 'rgb(30 79 191 / 0.08)',
    borderRadius: '4px',
    padding: '0 3px',
    fontWeight: '500',
  },
})

export const mentionAtoms = [atoms, look]
