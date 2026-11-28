// The one filter every task view shares, and whether its panel is open.
// Kept until the app is closed (sessionStorage): a filter forgotten overnight
// would hide tasks the next morning with nothing to say why. It is how this
// person is looking at their tasks, not part of them, so it is never saved
// to the tasks file. Read back through cleanFilter, which drops anything stale.
import { NO_FILTER, type ViewFilter } from '@/lib/view-filter'

const KEY = 'done-view-filter'

function read(): unknown {
  try {
    // Before #115 it was kept for ever in localStorage; that copy goes.
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to tidy where storage is refused.
  }
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') ?? NO_FILTER
  } catch {
    return NO_FILTER
  }
}

let stored: unknown = read()
let open = false
// The scope the filter's projects were last checked against: when it is not
// the scope being looked at, projects outside the new one are dropped.
let checkedFor: unknown = undefined
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}

export const subscribeViewFilter = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getStoredFilter = (): unknown => stored
export const getFilterOpen = (): boolean => open

export function setViewFilter(next: ViewFilter) {
  stored = next
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private windows may refuse storage; the filter still applies until a reload.
  }
  emit()
}

export function setFilterOpen(next: boolean) {
  open = next
  emit()
}

// Whether the scope changed since the filter was last checked; notes the
// scope as checked. The first call (the app starting) is not a change.
export function scopeChanged(scope: unknown): boolean {
  const changed = checkedFor !== undefined && checkedFor !== scope
  checkedFor = scope
  return changed
}
