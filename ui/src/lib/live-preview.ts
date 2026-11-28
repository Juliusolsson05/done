// A note written as Apple Notes shows it: the Markdown stays the text (it is
// what is stored, synced and read by agents), but while writing, its markers
// are hidden on every line the cursor is not on: a heading's #, the ** around
// bold, a list's dash (drawn as a bullet), a checklist's [ ] (drawn as a
// circle to tap). On the cursor's own line they come back, so they can be
// edited. This file is the part that is only text in and ranges out; the
// editor draws them (components/live-preview.ts).
import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

export interface Hide {
  from: number
  to: number
  // hide: gone. bullet / number / task: drawn as a widget in the margin.
  kind: 'hide' | 'bullet' | 'number' | 'task'
  // For a task: whether it is ticked. For a number: the displayed ordinal.
  checked?: boolean
  label?: string
}

export interface LineLook {
  // 1-based, as CodeMirror counts lines.
  line: number
  classes: string[]
  // For a list item: how deep it is (1 at the top).
  depth?: number
}

// A task mention or a note link is drawn whole by its own atom
// (components/mention-atoms), so its markers are not hidden piece by piece.
const MENTION_URL = /^done:(?:task|note)\//

// What the preview hides and how each line looks, for a document. `active`
// holds the lines the selection is on: nothing is hidden there.
export function previewRanges(state: EditorState, active: Set<number>): { hides: Hide[]; lines: LineLook[] } {
  const hides: Hide[] = []
  const nextOrdinal = new Map<number, number>()
  const looks = new Map<number, LineLook>()
  const doc = state.doc
  const lineOf = (pos: number) => doc.lineAt(pos)
  const look = (line: number) => {
    let found = looks.get(line)
    if (!found) looks.set(line, (found = { line, classes: [] }))
    return found
  }
  const quiet = (pos: number) => !active.has(lineOf(pos).number)
  const hide = (from: number, to: number) => {
    if (to > from && quiet(from)) hides.push({ from, to, kind: 'hide' })
  }

  // The first line is the note's title, as in Apple Notes, marked or not.
  look(1).classes.push('cm-title')

  // An empty line is Markdown's paragraph break: drawn short, as Apple Notes
  // spaces its paragraphs, except where the cursor is (it is typed on there).
  for (let n = 2; n <= doc.lines; n++) if (!active.has(n) && doc.line(n).text.trim() === '') look(n).classes.push('cm-blank')

  syntaxTree(state).iterate({
    enter(ref) {
      const name = ref.name
      const heading = /^ATXHeading(\d)$/.exec(name)
      if (heading) {
        look(lineOf(ref.from).number).classes.push(`cm-h${Math.min(3, Number(heading[1]))}`)
        return
      }
      if (name === 'HeaderMark') {
        const line = lineOf(ref.from)
        const text = line.text
        const start = ref.from - line.from
        if (text.slice(0, start).trim() === '') {
          // The opening marks and the space after them.
          let end = ref.to - line.from
          while (end < text.length && text[end] === ' ') end++
          hide(ref.from, line.from + end)
        } else {
          // A closing run (## Title ##): with the space before it.
          let begin = start
          while (begin > 0 && text[begin - 1] === ' ') begin--
          hide(line.from + begin, ref.to)
        }
        return
      }
      if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
        hide(ref.from, ref.to)
        return
      }
      if (name === 'Link') {
        const node = ref.node
        const url = node.getChild('URL')
        const marks = node.getChildren('LinkMark')
        if (!url || marks.length < 2 || MENTION_URL.test(state.sliceDoc(url.from, url.to))) return false
        // Only a link on one line; one broken over lines is left as written.
        if (lineOf(ref.from).number !== lineOf(ref.to).number) return false
        hide(marks[0].from, marks[0].to)
        hide(marks[1].from, ref.to)
        return false
      }
      if (name === 'ListMark') {
        const node = ref.node
        const list = node.parent?.parent
        if (!list) return
        let depth = 0
        for (let p = node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') depth++
        const line = lineOf(ref.from)
        const text = line.text
        // The item's own indentation goes with its marker: the margin is drawn
        // instead. Inside a quote the > stays.
        const from = text.slice(0, ref.from - line.from).trim() === '' ? line.from : ref.from
        const to = text[ref.to - line.from] === ' ' ? ref.to + 1 : ref.to
        const lineLook = look(line.number)
        lineLook.depth = depth
        // Editing the words leaves the marker and the text in place. Moving
        // the caret into the prefix exposes the spaces and punctuation.
        const showMarker = (end: number) => {
          const source = active.has(line.number) && state.selection.ranges.some(range =>
            range.empty ? range.head >= from && range.head < end : range.from < end && range.to > from,
          )
          if (source) lineLook.classes.push('cm-li-source')
          return !source
        }
        const task = node.nextSibling
        const marker = task?.name === 'Task' ? task.firstChild : null
        if (list.name === 'BulletList' && marker?.name === 'TaskMarker') {
          const checked = /x/i.test(state.sliceDoc(marker.from, marker.to))
          let end = marker.to
          if (state.sliceDoc(end, end + 1) === ' ') end++
          lineLook.classes.push('cm-li', 'cm-li-task')
          if (checked) lineLook.classes.push('cm-task-done')
          if (showMarker(end)) hides.push({ from, to: end, kind: 'task', checked })
        } else if (list.name === 'BulletList') {
          lineLook.classes.push('cm-li', 'cm-li-bullet')
          if (showMarker(to)) hides.push({ from, to, kind: 'bullet' })
        } else {
          lineLook.classes.push('cm-li', 'cm-li-number')
          const source = state.sliceDoc(ref.from, ref.to)
          const ordinal = nextOrdinal.get(list.from) ?? parseInt(source, 10)
          nextOrdinal.set(list.from, ordinal + 1)
          if (showMarker(to)) hides.push({ from, to, kind: 'number', label: String(ordinal) + source.slice(-1) })
        }
        return
      }
    },
  })

  hides.sort((a, b) => a.from - b.from || a.to - b.to)
  return { hides, lines: [...looks.values()].sort((a, b) => a.line - b.line) }
}

// ---------- Edits ----------

const LIST = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]/

// Tapping a checklist circle: the one character inside the box, ticked or not.
// `at` is its position in the line.
export function taskToggle(line: string): { at: number; insert: string } | null {
  const match = TASK.exec(line)
  if (!match) return null
  return { at: match[0].length - 2, insert: match[2] === ' ' ? 'x' : ' ' }
}

// The line made a checklist item, or one taken back to plain text. A
// heading or another list marker gives way to the box.
export function toggleChecklist(line: string): string {
  if (TASK.test(line)) return line.replace(LIST, '$1')
  const [whole, indent] = LIST.exec(line) as RegExpExecArray
  return indent + '- [ ] ' + line.slice(whole.length).replace(/^#{1,6}\s+/, '')
}

// The line made a bullet, or a bullet taken back to plain text.
export function toggleBullet(line: string): string {
  const [whole, indent] = LIST.exec(line) as RegExpExecArray
  const rest = line.slice(whole.length)
  if (/^\s*[-*+]\s+/.test(whole) && !TASK.test(line)) return indent + rest
  return indent + '- ' + rest.replace(/^#{1,6}\s+/, '')
}

export function toggleNumbered(line: string): string {
  const [whole, indent] = LIST.exec(line) as RegExpExecArray
  const rest = line.slice(whole.length)
  if (/^\s*\d+[.)]\s+/.test(whole)) return indent + rest
  return indent + '1. ' + rest.replace(/^#{1,6}\s+/, '')
}

// Heading, step by step: none, then #, then ##, then none again. A list
// marker gives way to it.
export function cycleHeading(line: string): string {
  const heading = /^(#{1,6})\s+/.exec(line)
  if (heading) return heading[1].length === 1 ? '## ' + line.slice(heading[0].length) : line.slice(heading[0].length)
  const [whole] = LIST.exec(line) as RegExpExecArray
  return '# ' + line.slice(whole.length)
}

// One change that turns `before` into `after`, touching only what differs.
// In a live note this is what everyone else receives.
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

type Change = { from: number; to?: number; insert: string }

// Bold, from the keyboard bar: the selection wrapped in **, or unwrapped if
// it already is; at a bare caret, an empty pair with the caret inside.
export function toggleBold(text: string, from: number, to: number): { changes: Change[]; anchor: number; head: number } {
  if (from === to) return { changes: [{ from, insert: '****' }], anchor: from + 2, head: from + 2 }
  // Selected inside the markers, or with them.
  if (text.slice(from - 2, from) === '**' && text.slice(to, to + 2) === '**')
    return { changes: [{ from: from - 2, to: from, insert: '' }, { from: to, to: to + 2, insert: '' }], anchor: from - 2, head: to - 2 }
  if (to - from >= 4 && text.slice(from, from + 2) === '**' && text.slice(to - 2, to) === '**')
    return { changes: [{ from, to: from + 2, insert: '' }, { from: to - 2, to, insert: '' }], anchor: from, head: to - 4 }
  return { changes: [{ from, insert: '**' }, { from: to, insert: '**' }], anchor: from + 2, head: to + 2 }
}

// ---------- The note around the text ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Under the title, as Apple Notes writes it: "23 November 2026 at 22:44".
export function dateLine(ms: number): string {
  const at = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()} at ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

// The list's width, the space between, and the least a note may have.
export const LIST_WIDTH = 256
export const LIST_GAP = 24
export const NOTE_MIN = 420

// Whether the Notes page, this wide, shows the list and the note side by
// side or one at a time (as a phone does).
export const notesLayout = (width: number): 'split' | 'stacked' => (width >= LIST_WIDTH + LIST_GAP + NOTE_MIN ? 'split' : 'stacked')

// How much of the window's bottom the on-screen keyboard covers, from the
// visual viewport (the part of the page that can be seen).
export const keyboardInset = (innerHeight: number, viewport: { offsetTop: number; height: number }): number =>
  Math.max(0, Math.round(innerHeight - viewport.offsetTop - viewport.height))
