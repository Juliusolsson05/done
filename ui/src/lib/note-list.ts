// Numbered markers are variable width. A child starts under the parent's
// content, and changing 10. to 1. shifts that item's children by one column.
import { syntaxTree } from '@codemirror/language'
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { countColumn, type EditorState, type StateCommand } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { minimalChange, toggleBullet, toggleChecklist, toggleNumbered } from './live-preview'

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })
export const continueList: StateCommand = (target) => !target.state.readOnly && continueMarkup(target)

// A continuation belongs to the innermost enclosing item. A code or quote
// block has its own indentation rules, even when nested in a list.
function blockAtLine(state: EditorState, number: number) {
  const line = state.doc.line(number)
  const first = line.text.search(/\S/)
  const pos = first < 0 ? line.to : line.from + first + 1
  for (let node: SyntaxNode | null = syntaxTree(state).resolve(pos, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'Blockquote' || node.name === 'ListItem') return node
  }
  return null
}

export function selectedLines(state: EditorState) {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to > from ? to - 1 : to).number
  return { first, last }
}

function marker(state: EditorState, item: SyntaxNode) {
  const line = state.doc.lineAt(item.from)
  const mark = item.getChild('ListMark')!
  const prefix = line.text.slice(0, mark.from - line.from)
  const text = state.sliceDoc(mark.from, mark.to)
  const indent = countColumn(prefix, 4)
  const after = /^[ \t]*/.exec(line.text.slice(mark.to - line.from))![0]
  const spacing = countColumn(prefix + text + after, 4) - indent - text.length
  return { line: line.number, text, indent, content: indent + text.length + (spacing > 0 && spacing <= 4 ? spacing : 1) }
}

function ordinal(state: EditorState, item: SyntaxNode) {
  const siblings = item.parent!.getChildren('ListItem')
  return parseInt(marker(state, siblings[0]).text, 10) + siblings.findIndex((sibling) => sibling.from === item.from)
}

type Direction = 'in' | 'out'

// Used by both the shortcut and the menu's enabled state. Resolve the
// whole selected set before offering a move that could strand one item.
export function listMoveAt(state: EditorState, direction: Direction) {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const selected = selectedLines(state)
  const first = blockAtLine(state, selected.first)
  if (first?.name !== 'ListItem') return null
  const items = [first]
  while (state.doc.lineAt(items[items.length - 1].to).number < selected.last) {
    const sibling = items[items.length - 1].nextSibling
    if (!sibling || sibling.name !== 'ListItem') return null
    items.push(sibling)
  }
  const precedingList = first.parent?.prevSibling
  const precedingItem =
    first.prevSibling ?? (precedingList?.name === 'OrderedList' || precedingList?.name === 'BulletList' ? precedingList.lastChild : null)
  const parent = direction === 'in' ? precedingItem : first.parent?.parent
  if (parent?.name !== 'ListItem') return null
  return { items, parent }
}

function editOutline(state: EditorState) {
  const lines = new Map<number, string>()
  const readLine = (n: number) => lines.get(n) ?? state.doc.line(n).text
  function shift(startLine: number, endLine: number, columns: number) {
    if (!columns) return
    for (let n = startLine; n <= endLine; n++) {
      const line = readLine(n)
      if (!line.trim()) continue
      const before = /^[ \t]*/.exec(line)![0]
      lines.set(n, ' '.repeat(Math.max(0, countColumn(before, 4) + columns)) + line.slice(before.length))
    }
  }
  const changes = () =>
    [...lines.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([n, text]) => {
        const line = state.doc.line(n)
        const change = minimalChange(line.text, text)
        return change ? [{ from: line.from + change.from, to: line.from + change.to, insert: change.insert }] : []
      })
  return { lines, readLine, shift, changes }
}

function moveList(direction: Direction): StateCommand {
  return ({ state, dispatch }) => {
    const move = listMoveAt(state, direction)
    if (!move) return false
    const { items, parent } = move
    const first = items[0]
    const destination = marker(state, parent)
    const firstMark = marker(state, first)
    const order = first.parent!.name === 'OrderedList'
    const joiningParentList = direction === 'out' && parent.parent?.name === 'OrderedList'
    const delimiter = joiningParentList ? destination.text.slice(-1) : firstMark.text.slice(-1)
    let indent = direction === 'out' ? destination.indent : destination.content
    let nextNumber = joiningParentList ? ordinal(state, parent) + 1 : 1
    const childList = parent.lastChild
    const tail = childList?.lastChild
    if (
      direction === 'in' &&
      childList?.name === first.parent?.name &&
      tail?.name === 'ListItem' &&
      marker(state, tail).text.slice(-1) === delimiter
    ) {
      indent = marker(state, tail).indent
      if (order) nextNumber = ordinal(state, tail) + 1
    }

    const { lines, readLine, shift, changes } = editOutline(state)
    function setNumber(item: SyntaxNode, number: number, suffix: string) {
      const old = marker(state, item)
      const next = String(number) + suffix
      lines.set(
        old.line,
        readLine(old.line).replace(/^(\s*)\d+[.)]/, (_, spaces: string) => spaces + next),
      )
      shift(old.line + 1, state.doc.lineAt(item.to).number, next.length - old.text.length)
    }

    for (const item of items) {
      const old = marker(state, item)
      shift(old.line, state.doc.lineAt(item.to).number, indent - old.indent)
      if (order) setNumber(item, nextNumber++, delimiter)
    }
    const last = items[items.length - 1]
    if (direction === 'in' && order) {
      let number = ordinal(state, first)
      for (let item = last.nextSibling; item; item = item.nextSibling) setNumber(item, number++, delimiter)
    }
    // Lifting from the middle keeps the written order: the following items
    // now sit under the lifted item. Start their numbering at its last child.
    if (direction === 'out' && last.nextSibling) {
      const old = marker(state, last)
      const newMarker = order ? String(nextNumber - 1) + delimiter : old.text
      const childIndent = indent + old.content - old.indent + newMarker.length - old.text.length
      const childList = last.lastChild
      const tail = childList?.name === first.parent?.name ? childList?.lastChild : null
      let number = order && tail && marker(state, tail).text.slice(-1) === firstMark.text.slice(-1) ? ordinal(state, tail) + 1 : 1
      for (let item: SyntaxNode | null = last.nextSibling; item; item = item.nextSibling) {
        const prior = marker(state, item)
        shift(prior.line, state.doc.lineAt(item.to).number, childIndent - prior.indent)
        if (order) setNumber(item, number++, firstMark.text.slice(-1))
      }
    }
    if (order && joiningParentList) {
      for (let item = parent.nextSibling; item; item = item.nextSibling) setNumber(item, nextNumber++, delimiter)
    }

    const changed = changes()
    if (!changed.length) return false
    dispatch(state.update({ changes: changed, userEvent: 'input.indent', scrollIntoView: true }))
    return true
  }
}

export const indentList = moveList('in')
export const outdentList = moveList('out')

// Converting a selected parent converts its marker once. Everything below
// it retains its own marker and shifts with the parent's content column.
function formatList(format: (text: string) => string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly || state.selection.ranges.length !== 1) return false
    const { first, last } = selectedLines(state)
    const { lines, shift, changes } = editOutline(state)
    for (let n = first; n <= last; n++) {
      const block = blockAtLine(state, n)
      if (block && block.name !== 'ListItem') continue
      const line = block ? state.doc.lineAt(block.from) : state.doc.line(n)
      const next = format(line.text)
      lines.set(line.number, next)
      if (block) {
        const old = marker(state, block)
        const prefix = /^(?:[-+*]|\d{1,9}[.)]) +/.exec(next.trimStart())
        const newWidth = prefix?.[0].length ?? 0
        n = state.doc.lineAt(block.to).number
        shift(line.number + 1, n, newWidth - (old.content - old.indent))
      }
    }
    const changed = state.changes(changes())
    if (changed.empty) return false
    const sel = state.selection.main
    const selection = sel.empty ? { anchor: changed.mapPos(sel.head, 1) } : undefined
    dispatch(state.update({ changes: changed, selection, userEvent: 'input.format', scrollIntoView: true }))
    return true
  }
}

export const bulletedList = formatList(toggleBullet)
export const numberedList = formatList(toggleNumbered)
export const checklist = formatList(toggleChecklist)
