// The focus timer: a countdown on one task. All of it is plain data in, plain
// data out, with the time passed in as `now` (milliseconds since 1970).
//
// A session runs from timestamps, never from counting ticks, so it stays
// right through sleep, a hidden window or a reload.
import type { Day } from '@/lib/days'
import { byPriority, openTasks, type Task } from '@/lib/tasks'

export interface Session {
  // Null when focusing on nothing in particular.
  taskId: number | null
  title: string
  // When the countdown reaches zero. Set while running, null while paused.
  endsAt: number | null
  // What is left, in milliseconds. Set while paused, null while running.
  remaining: number | null
  // Time is up and it has been said, so it is said only once.
  ended: boolean
}

// The lengths offered as buttons, in minutes.
export const PRESETS = [15, 25, 30, 45, 60, 90, 120]
export const DEFAULT_MINUTES = 25
export const MAX_MINUTES = 600
export const presetLabel = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`)

const MINUTE = 60000

export function timeLeft(session: Session | null, now: number): number {
  if (!session) return 0
  if (session.endsAt !== null) return Math.max(0, session.endsAt - now)
  return session.remaining ?? 0
}

const two = (n: number) => String(n).padStart(2, '0')

// 24:59, or 1:04:59 from an hour up. Seconds are rounded up, so a fresh 25
// minutes reads 25:00 and the clock reaches 0:00 exactly when time is up.
// The menu bar writes its clock the same way.
export function clockText(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return (hours ? `${hours}:${two(minutes)}` : String(minutes)) + ':' + two(seconds % 60)
}

export const start = (task: Pick<Task, 'id' | 'title'> | null, minutes: number, now: number): Session => ({
  taskId: task ? task.id : null,
  title: task ? task.title : 'Focus',
  endsAt: now + minutes * MINUTE,
  remaining: null,
  ended: false,
})

// Pause a running session, or resume a paused one. Pausing keeps what is
// left rather than the end time, which goes stale while paused.
export function toggle(session: Session, now: number): Session {
  if (session.ended) return session
  if (session.endsAt !== null) return { ...session, endsAt: null, remaining: timeLeft(session, now) }
  return { ...session, endsAt: now + (session.remaining ?? 0), remaining: null }
}

// A running session whose time has passed and has not been announced yet.
export const isDue = (session: Session, now: number): boolean =>
  session.endsAt !== null && !session.ended && timeLeft(session, now) === 0

// Time is up. The end time is kept: the menu bar shows 0:00 from it until
// the session is closed.
export const finish = (session: Session): Session => ({ ...session, remaining: null, ended: true })

// "10 more minutes" counts from the moment it is asked for, not from when the
// time ran out, which may have been a while ago.
export const extend = (session: Session, minutes: number, now: number): Session => ({
  ...session,
  endsAt: now + minutes * MINUTE,
  remaining: null,
  ended: false,
})

// The minutes field wins over the buttons when something is typed in it.
export function chosenMinutes(typed: string, preset: number): number {
  const minutes = Number(typed)
  return minutes > 0 ? Math.min(minutes, MAX_MINUTES) : preset
}

// The tasks offered to focus on: today's goal first, then what is due today
// or overdue, then everything else.
export function focusTasks(tasks: Task[], today: Day): Task[] {
  const rank = (t: Task) => (t.goalDay === today ? 0 : t.due !== null && t.due <= today ? 1 : 2)
  return openTasks(tasks).sort((a, b) => rank(a) - rank(b) || byPriority(a, b))
}
