// Notes: free text that is not a task, such as a list jotted down in the
// middle of a conversation. Kept apart from the tasks and their revision.

export interface Note {
  id: number
  text: string
  // Milliseconds since 1970. The list shows the most recently changed first.
  updatedAt: number
}

// What a window sends to save a note: without an id it is a new one.
export interface SaveNote {
  id?: number
  text: string
  updatedAt: number
}

// The first line with something on it names the note in the list.
export function titleOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')
  return line ? line.trim() : 'New note'
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
