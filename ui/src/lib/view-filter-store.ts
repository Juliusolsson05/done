// The filter the Board and the Timeline share, and whether its panel is open.
// Remembered in this device's storage: it is how this person likes to look
// at their tasks, not part of the tasks, so it is never saved to the tasks
// file. Read back through cleanFilter, which drops anything stale.
import { NO_FILTER, type ViewFilter } from '@/lib/view-filter'

const KEY = 'done-view-filter'

function read(): unknown {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? NO_FILTER
  } catch {
    return NO_FILTER
  }
}

let stored: unknown = read()
let open = false
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
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private windows may refuse storage; the filter still applies until a reload.
  }
  emit()
}

export function setFilterOpen(next: boolean) {
  open = next
  emit()
}
