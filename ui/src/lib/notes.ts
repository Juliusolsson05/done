// Notes: free text that is not a task, such as a list jotted down in the
// middle of a conversation. Kept apart from the tasks and their revision.
import { withoutMentionSyntax } from '@/lib/mentions'
import { matchesQuery } from '@/lib/search'

export interface Note {
  id: number
  text: string
  // Milliseconds since 1970. The list shows the most recently changed first.
  updatedAt: number
  // The project it belongs to, if any.
  projectId?: number | null
  // The folder it is filed in, by name, if any.
  folder?: string | null
  // The space it lives in: its project's, or the workspace it was written in.
  spaceId?: number | null
}

// What a window sends to save a note: without an id it is a new one.
export interface SaveNote {
  id?: number
  text: string
  updatedAt: number
  projectId?: number | null
  folder?: string | null
  // For a new note: the workspace it is written in; none is your own.
  spaceId?: number | null
}

// The first line with something on it names the note in the list, without
// the Markdown that marks it as a heading ("# Funds" is "Funds"), and with a
// mentioned task as its words alone.
export function titleOf(text: string): string {
  for (const line of text.split('\n')) {
    const title = withoutMentionSyntax(line)
      .replace(/^\s{0,3}#{1,6}(\s+|$)/, '')
      .replace(/\s+#+\s*$/, '')
      .trim()
    if (title) return title
  }
  return 'New note'
}

// A line read without its Markdown: no heading or list marker, no checklist
// box, no ** or ~~, a link as its words.
const plainLine = (line: string): string =>
  withoutMentionSyntax(line)
    .replace(/^\s{0,3}#{1,6}(\s+|$)/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\s+#+\s*$/, '')
    .trim()

// What the list shows under a note's title, as Apple Notes does: the first
// line with words after the title's line.
export function snippetOf(text: string): string {
  let titled = false
  for (const line of text.split('\n')) {
    const plain = plainLine(line)
    if (!plain) continue
    if (!titled) {
      titled = true
      continue
    }
    return plain
  }
  return ''
}

// When a note was last changed: the time if today, otherwise the date.
export function whenText(updatedAt: number, now: number): string {
  const at = new Date(updatedAt)
  const today = new Date(now)
  if (at.toDateString() === today.toDateString()) return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameYear = at.getFullYear() === today.getFullYear()
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

export const isBlank = (text: string): boolean => text.trim() === ''

// Newest change first, as the list shows them.
export const byNewest = (a: Note, b: Note): number => b.updatedAt - a.updatedAt || b.id - a.id

// Every word of the query appears somewhere in the note. An empty query matches all.
export const matches = (note: Note, query: string): boolean => matchesQuery(note.text, query)

export interface DateGroup {
  label: string
  notes: Note[]
}

// Whole calendar days between two instants, in local time.
function daysBetween(earlier: number, later: number): number {
  const day = (ms: number) => {
    const d = new Date(ms)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return Math.round((day(later) - day(earlier)) / 86_400_000)
}

// The heading a note is listed under, as in Apple Notes.
function groupLabel(updatedAt: number, now: number): string {
  const days = daysBetween(updatedAt, now)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days <= 7) return 'Previous 7 Days'
  if (days <= 30) return 'Previous 30 Days'
  const at = new Date(updatedAt)
  if (at.getFullYear() === new Date(now).getFullYear()) return at.toLocaleDateString('en-US', { month: 'long' })
  return String(at.getFullYear())
}

// The notes, newest first, under their date headings. Only headings with notes.
export function groupByDate(notes: Note[], now: number): DateGroup[] {
  const groups: DateGroup[] = []
  for (const note of [...notes].sort(byNewest)) {
    const label = groupLabel(note.updatedAt, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.notes.push(note)
    else groups.push({ label, notes: [note] })
  }
  return groups
}

// In a note, Enter means a new line, as it does while writing. Markdown would
// join two lines into one paragraph, so each line that runs on to another is
// ended with a hard break first. Code blocks and tables are left as written.
export function keepLineBreaks(text: string): string {
  const lines = text.split('\n')
  let inCode = false
  return lines
    .map((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCode = !inCode
        return line
      }
      const next = lines[i + 1]
      const runsOn = next !== undefined && next.trim() !== '' && line.trim() !== ''
      // Lists, headings, quotes and tables keep their own lines already; a
      // break added to them could join the next item to this one.
      const structured = (l: string | undefined) => l !== undefined && /^\s*([-*+]\s|\d+[.)]\s|#|>|\|)/.test(l)
      return inCode || !runsOn || structured(line) || structured(next) ? line : line.replace(/\s*$/, '') + '\\'
    })
    .join('\n')
}

// ---------- Folders ----------
// A folder is a name on its notes, so it exists while a note is in it. The
// tasks file keeps names the same way (crates/core clean_folder): trimmed,
// spaces collapsed, at most 60 characters, and a blank name is no folder.

export function cleanFolder(name: string): string | null {
  const clean = name.split(/\s+/).filter(Boolean).join(' ')
  return clean ? [...clean].slice(0, 60).join('') : null
}

// One folder whatever the case it was typed in: "ideas" files into "Ideas".
export const sameFolder = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()

export interface Folder {
  name: string
  count: number
}

// The folders to list: every folder a note is in, and those made on this
// device that are still empty (`kept`), once each ignoring case, by name.
export function folderList(notes: Note[], kept: string[]): Folder[] {
  const folders: Folder[] = []
  for (const name of [...notes.flatMap((n) => (n.folder ? [n.folder] : [])), ...kept]) {
    const found = folders.find((f) => sameFolder(f.name, name))
    if (!found) folders.push({ name, count: 0 })
  }
  for (const note of notes) {
    const found = note.folder ? folders.find((f) => sameFolder(f.name, note.folder as string)) : undefined
    if (found) found.count++
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

// Whether a note is listed with this folder chosen; null is All notes.
export const inFolder = (note: Note, folder: string | null): boolean => folder === null || (!!note.folder && sameFolder(note.folder, folder))

// The notes in folder `from`, moved to `to` (null takes them out of any
// folder). Only those notes, so renaming or deleting a folder writes nothing else.
export const withFolder = (notes: Note[], from: string, to: string | null): Note[] =>
  notes.filter((n) => n.folder && sameFolder(n.folder, from)).map((n) => ({ ...n, folder: to }))
