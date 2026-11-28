// Where the workspace picker is: All, your own space, or one workspace.
// Remembered on this device only, as a convenience: a reload comes back to
// the same place. Checked against the spaces every time it is read, so a
// workspace left or deleted is never stood in.
import { useSyncExternalStore } from 'react'
import type { Scope } from '@/lib/team'

const KEY = 'done-scope'
const listeners = new Set<() => void>()

function read(): Scope {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null || raw === 'all') return 'all'
    if (raw === 'personal') return 'personal'
    const id = Number(raw)
    return Number.isSafeInteger(id) ? id : 'all'
  } catch {
    return 'all'
  }
}

let current: Scope = read()

export function setScope(scope: Scope) {
  current = scope
  try {
    localStorage.setItem(KEY, String(scope))
  } catch {
    // Storage may be off; the choice still holds until a reload.
  }
  for (const listener of listeners) listener()
}

// Where the picker is now, for code that runs outside a render.
export const getScope = (): Scope => current

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useScope = (): Scope =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  )
