// Where the phone's back button goes: back to the screen you came from, as in
// any iOS app, not always to Lists. A short stack of the views you left, kept
// in the UI state and lost on reload like the rest of it.
import type { View } from '@/lib/tasks'

// Enough to walk back through any real path; the oldest are forgotten.
const KEPT = 20

// The stack after going from `from` to `to`. A tab is a starting point of its
// own, so opening one starts over. Moving within one kind of view (from note to
// note, list to list) replaces where you are rather than adding a step, so
// back leaves Notes instead of walking through every note read.
export function opened(history: View[], from: View, to: View, toTab: boolean): View[] {
  if (toTab) return []
  if (from.kind === to.kind) return history
  return [...history, from].slice(-KEPT)
}

// Where back goes, and the stack after it: the last view left that still
// exists (a list may have been deleted since), or Lists.
export function back(history: View[], exists: (view: View) => boolean): { view: View; history: View[] } {
  const rest = [...history]
  while (rest.length > 0) {
    const view = rest.pop()!
    if (exists(view)) return { view, history: rest }
  }
  return { view: { kind: 'lists' }, history: [] }
}
