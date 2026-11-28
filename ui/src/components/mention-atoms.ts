// The saved link occupies one cursor stop. CodeMirror owns its span while
// React draws the same task card or chip as Read, with the live app context.
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { mentionRanges, type LinkRange } from '@/lib/mentions'

type ShowLink = (host: HTMLElement, link: LinkRange | null) => void

class Mention extends WidgetType {
  constructor(readonly link: LinkRange, readonly show: ShowLink) {
    super()
  }
  eq(other: Mention) {
    return this.link.id === other.link.id && this.link.kind === other.link.kind && this.link.label === other.link.label && this.link.card === other.link.card
  }
  toDOM() {
    const host = document.createElement('span')
    // List lines have a hanging indent. A task's own title and description
    // should wrap inside the card, independent of the line it sits on.
    host.style.textIndent = '0'
    if (this.link.card) host.className = 'inline-block max-w-full align-middle text-base font-normal tracking-normal'
    this.show(host, this.link)
    return host
  }
  destroy(host: HTMLElement) {
    this.show(host, null)
  }
}

export function mentionAtoms(show: ShowLink) {
  const draw = (state: EditorState) => {
    const builder = new RangeSetBuilder<Decoration>()
    // Reuse CodeMirror's incremental parse when it covers the document.
    const tree = syntaxTreeAvailable(state) ? syntaxTree(state) : undefined
    for (const link of mentionRanges(state.doc.toString(), tree)) {
      builder.add(link.from, link.to, Decoration.replace({ widget: new Mention(link, show) }))
    }
    return builder.finish()
  }
  // Supply decorations directly: a card can change a line's height, so
  // CodeMirror needs its range before deciding which lines to draw.
  return StateField.define({
    create: draw,
    update: (value, tr) => tr.docChanged ? draw(tr.state) : value,
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ],
  })
}
