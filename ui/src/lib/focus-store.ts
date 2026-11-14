// The focus session this window is running. Kept apart from the tasks: it is
// a few minutes of state for one window, remembered in the browser's storage
// so it survives a reload, and never saved to the tasks file.
import { showInMenuBar } from '@/lib/backend'
import { extend, finish, start, toggle, type Session } from '@/lib/focus'
import type { Task } from '@/lib/tasks'

const KEY = 'done-focus'

function stored(): Session | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    // Only the shape is checked: whatever else is in storage is not a session.
    if (typeof value !== 'object' || value === null || !('title' in value) || !('endsAt' in value)) return null
    return value as Session
  } catch {
    return null
  }
}

let session: Session | null = stored()
const listeners = new Set<() => void>()

export const subscribeFocus = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getFocus = (): Session | null => session

// Tells the menu bar. An ended session is still sent: the menu bar is what
// rings, and it shows 0:00 until the session is closed. Also called once at
// start-up, for a session that was running before a reload.
export const handOff = (): void => showInMenuBar(session ? { endsAt: session.endsAt, remaining: session.remaining } : null)

function set(next: Session | null) {
  if (next === session) return
  session = next
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // Private windows may refuse storage; the session still runs until a reload.
  }
  handOff()
  for (const listener of listeners) listener()
}

export const startFocus = (task: Task | null, minutes: number): void => set(start(task, minutes, Date.now()))
export const toggleFocus = (): void => set(session && toggle(session, Date.now()))
export const endFocus = (): void => set(null)
export const moreFocus = (minutes: number): void => set(session && extend(session, minutes, Date.now()))

// Marks a session as ended. False when there was nothing to end, so the
// caller announces it only once.
export function timeIsUp(): boolean {
  if (!session || session.ended) return false
  set(finish(session))
  return true
}
