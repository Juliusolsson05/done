// Notes: free text that is not a task, such as a list jotted down in the
// middle of a conversation. Kept apart from the tasks and their revision.
import { matchesQuery } from '@/lib/search'

export interface Note {
  id: number
  text: string
  // Milliseconds since 1970. The list shows the most recently changed first.
  updatedAt: number
  // The project it belongs to, if any.
  projectId?: number | null
}

// What a window sends to save a note: without an id it is a new one.
export interface SaveNote {
  id?: number
  text: string
  updatedAt: number
  projectId?: number | null
}

// The first line with something on it names the note in the list, without
// the Markdown that marks it as a heading ("# Funds" is "Funds").
export function titleOf(text: string): string {
  for (const line of text.split('\n')) {
    const title = line
      .replace(/^\s{0,3}#{1,6}(\s+|$)/, '')
      .replace(/\s+#+\s*$/, '')
      .trim()
    if (title) return title
  }
  return 'New note'
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
