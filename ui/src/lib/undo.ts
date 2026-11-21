// Undo, Cmd+Z, for the whole app. Every change to tasks and projects is
// written down as what it changed, and undoing puts exactly those back:
// another window's or an agent's edit to anything else is left alone.
// Other things that can be undone (deleting a note) add their own step.
import type { Data } from '@/lib/tasks'

// Puts back, in `now`, what went from `before` to `after`: items changed or
// removed get their old version back, items added are removed again.
export function revert(before: Data, after: Data, now: Data): Data {
  const back = <T extends { id: number }>(was: T[], became: T[], current: T[]): T[] => {
    const old = new Map(was.map((x) => [x.id, x]))
    const changed = new Set(became.filter((x) => JSON.stringify(old.get(x.id)) !== JSON.stringify(x)).map((x) => x.id))
    const removed = was.filter((x) => !became.some((y) => y.id === x.id)).map((x) => x.id)
    const touched = new Set([...changed, ...removed])
    const kept = current.filter((x) => !touched.has(x.id))
    const restored = [...touched].map((id) => old.get(id)).filter((x): x is T => x !== undefined)
    return [...kept, ...restored]
  }
  return {
    ...now,
    projects: back(before.projects, after.projects, now.projects),
    tasks: back(before.tasks, after.tasks, now.tasks),
  }
}

interface Step {
  undo: () => void
  // For merging: a change of tasks and projects, and when it was made.
  tasks?: { before: Data; after: Data; at: number }
}

// Changes this close together are one step: a drag on the timeline is many
// small changes, but one thing done.
const MERGE_MS = 1000
const KEEP = 50
const steps: Step[] = []

// A change of tasks and projects, from `before` to `after`. `apply` makes a
// change without recording it (the store's own change function).
export function recordChange(before: Data, after: Data, apply: (fn: (d: Data) => Data) => void, now = Date.now()) {
  const last = steps[steps.length - 1]
  if (last?.tasks && now - last.tasks.at < MERGE_MS) {
    last.tasks.after = after
    last.tasks.at = now
    return
  }
  const step: Step = {
    tasks: { before, after, at: now },
    undo: () => apply((current) => revert(step.tasks!.before, step.tasks!.after, current)),
  }
  push(step)
}

// Something else that can be undone, such as deleting a note.
export function recordStep(undo: () => void) {
  push({ undo })
}

function push(step: Step) {
  steps.push(step)
  if (steps.length > KEEP) steps.shift()
}

// Undoes the last step. False when there is nothing to undo.
export function undoLast(): boolean {
  const step = steps.pop()
  if (!step) return false
  step.undo()
  return true
}

// The last step was undone some other way (the Undo button on a message), so
// Cmd+Z must not do it again.
export function forgetLast() {
  steps.pop()
}

export const canUndo = (): boolean => steps.length > 0
