// What done's Home and Lock Screen widgets show, as the app hands it to them
// (crates/app `widget_snapshot` → gen/apple/Sources/done-app/DoneNative.swift →
// a file in the App Group container the widget extension reads).
//
// WHY the interface builds it, not Rust or Swift: "Today" is decided here
// (`sections`, the goal, the scope picker's filter), so the widget shows
// exactly what Today in the app shows; a second copy of those rules in
// another language would drift. The extension only draws what it is given.
//
// The field names are the Swift `DoneSnapshot`'s (Shared/DoneShared.swift);
// change both together. Times are in seconds, as Swift's Date wants them.
import { goalTask, sections, type Task } from '@/lib/tasks'
import type { Day } from '@/lib/days'

export interface WidgetSnapshot {
  left: number
  tasks: { id: number; title: string; mark: 'goal' | 'overdue' | 'today' }[]
  focus: { title: string; endsAt: number | null; remaining: number | null } | null
  at: number
}

// The largest widget shows nine rows; more is never drawn.
const ROWS = 9

export function widgetSnapshot(
  tasks: Task[],
  today: Day,
  me: string | null,
  focus: { title: string; endsAt: number | null; remaining: number | null } | null,
  now: number,
  keep: (t: Task) => boolean = () => true,
  // Workspace tasks a signed-out device keeps only to send them later
  // (Data.withheld): not for the Home Screen.
  withheld: number[] = [],
): WidgetSnapshot {
  if (withheld.length) tasks = tasks.filter((t) => !withheld.includes(t.id))
  // As Today draws it: the goal on top, then overdue, then today.
  const goal = goalTask(tasks, today, me)
  const listed = sections({ kind: 'today' }, tasks, today, keep).flatMap((s) =>
    s.tasks.map((t) => ({ id: t.id, title: t.title, mark: (s.late ? 'overdue' : 'today') as 'overdue' | 'today' })),
  )
  const rows = [...(goal && !goal.done ? [{ id: goal.id, title: goal.title, mark: 'goal' as const }] : []), ...listed]
  return {
    left: rows.length,
    tasks: rows.slice(0, ROWS),
    focus: focus && {
      title: focus.title,
      endsAt: focus.endsAt === null ? null : focus.endsAt / 1000,
      remaining: focus.remaining === null ? null : focus.remaining / 1000,
    },
    at: now / 1000,
  }
}
