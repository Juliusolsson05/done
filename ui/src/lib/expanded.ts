// Which tasks have their subtasks showing. Kept per window in browser
// storage: it is how this window was left, not something about the tasks, so
// it is not saved to the tasks file and an agent never sees it.
import { useSyncExternalStore } from 'react'

const KEY = 'done-expanded'

function read(): Set<number> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((id): id is number => typeof id === 'number') : [])
  } catch {
    // Storage can be blocked or hold something unreadable; everything simply
    // starts collapsed.
    return new Set()
  }
}

let expanded = read()
const listeners = new Set<() => void>()

function set(next: Set<number>) {
  expanded = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    // Not remembered past this window, which is all that is lost.
  }
  for (const listener of listeners) listener()
}

export const toggled = (open: Set<number>, id: number): Set<number> => {
  const next = new Set(open)
  if (!next.delete(id)) next.add(id)
  return next
}

export const toggleExpanded = (id: number) => set(toggled(expanded, id))
export const expand = (id: number) => {
  if (!expanded.has(id)) set(new Set(expanded).add(id))
}

export function useExpanded(id: number): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => expanded.has(id),
    // Drawn without a browser (a note rendered to text in a test): as stored.
    () => expanded.has(id),
  )
}
