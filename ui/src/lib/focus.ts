// The focus timer: a countdown on one task. All of it is plain data in, plain
// data out, with the time passed in as `now` (milliseconds since 1970).
//
// A session runs from timestamps, never from counting ticks, so it stays
// right through sleep, a hidden window or a reload.
import { dayOf, type Day } from '@/lib/days'
import { byPriority, openTasks, type Task } from '@/lib/tasks'
import type { NewEntry } from '@/lib/time-sheet'

// Something to be told every so many minutes of focus: "Stand up and stretch".
export interface Reminder {
  id: string
  label: string
  intervalMinutes: number
}

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
  // How long the session is in all, in milliseconds. Time focused so far is
  // this minus what is left. One number that never changes while the clock
  // runs, so it needs no upkeep through pause, reload or sleep (what is left
  // already survives those); only "more minutes" adds to it, which is what
  // keeps the time focused from starting over, and old reminders with it.
  total: number
  // The reminders as they were when the session started.
  reminders: Reminder[]
  // Which intervals have been said, as "id:nth". Remembering these, rather
  // than testing for the exact moment an interval is reached, is what lets a
  // late look at the clock say a missed one once, and never one twice.
  fired: string[]
  // The reminder being shown. The session is paused until it is dismissed.
  reminding: Reminder | null
  // When it was started, for the time sheet's clock times.
  startedAt: number
  // The length it was started with, in milliseconds. Unlike `total`, asking
  // for more time leaves this alone: it is what the time sheet compares
  // the time really taken against.
  planned: number
}

// A block waiting in Up next: what to work on and the time it should take.
export interface Block {
  id: string
  taskId: number | null
  // Kept so a block still reads if its task is finished or deleted meanwhile.
  title: string
  minutes: number
}

// The lengths offered as buttons, in minutes.
export const PRESETS = [15, 25, 30, 45, 60, 90, 120]
export const DEFAULT_MINUTES = 25
export const MAX_MINUTES = 600
export const presetLabel = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`)
// The lengths most sessions use, shown as buttons; the other presets and a
// length of your own are one tap further, behind "Other".
export const COMMON = [25, 45, 60]

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

export const start = (task: Pick<Task, 'id' | 'title'> | null, minutes: number, now: number, reminders: Reminder[] = []): Session => ({
  taskId: task ? task.id : null,
  title: task ? task.title : 'Focus',
  endsAt: now + minutes * MINUTE,
  remaining: null,
  ended: false,
  total: minutes * MINUTE,
  reminders,
  fired: [],
  reminding: null,
  startedAt: now,
  planned: minutes * MINUTE,
})

// Pause a running session, or resume a paused one. Pausing keeps what is
// left rather than the end time, which goes stale while paused. Resuming
// also dismisses a reminder: it is a pause that says why.
export function toggle(session: Session, now: number): Session {
  if (session.ended) return session
  if (session.endsAt !== null) return { ...session, endsAt: null, remaining: timeLeft(session, now) }
  return { ...session, endsAt: now + (session.remaining ?? 0), remaining: null, reminding: null }
}

// The intervals each reminder has reached by now, as the keys kept in `fired`.
function reached(session: Session, now: number): { reminder: Reminder; key: string }[] {
  const focused = session.total - timeLeft(session, now)
  return session.reminders
    .map((reminder) => ({ reminder, nth: Math.floor(focused / (reminder.intervalMinutes * MINUTE)) }))
    .filter(({ nth }) => nth >= 1)
    .map(({ reminder, nth }) => ({ reminder, key: `${reminder.id}:${nth}` }))
}

// The reminder to show now, if any: the first whose latest interval has not
// been said. Only while the clock runs, and not at zero: the end wins.
export function dueReminder(session: Session, now: number): Reminder | null {
  if (session.endsAt === null || session.ended || timeLeft(session, now) === 0) return null
  return reached(session, now).find(({ key }) => !session.fired.includes(key))?.reminder ?? null
}

// Show a reminder: the session pauses, and the interval is marked as said.
export function fire(session: Session, reminder: Reminder, now: number): Session {
  const key = reached(session, now).find((r) => r.reminder === reminder)?.key
  return {
    ...session,
    endsAt: null,
    remaining: timeLeft(session, now),
    fired: key ? [...session.fired, key] : session.fired,
    reminding: reminder,
  }
}

// Continue after a reminder. The break has cost no focus time.
export const dismiss = (session: Session, now: number): Session => (session.reminding ? toggle(session, now) : session)

// When the next reminder comes, for the menu bar to wake a hidden window
// at. Null when none comes before the end, or the clock is not running.
export function nextReminderAt(session: Session, now: number): number | null {
  if (session.endsAt === null || session.ended) return null
  if (dueReminder(session, now)) return now
  const startedAt = session.endsAt - session.total
  const focused = now - startedAt
  const times = session.reminders
    .map((reminder) => reminder.intervalMinutes * MINUTE)
    .map((interval) => (Math.floor(focused / interval) + 1) * interval)
    .filter((at) => at < session.total)
  return times.length ? startedAt + Math.min(...times) : null
}

// A reminder for the list, or null when it has no label or no interval.
export function newReminder(id: string, label: string, minutes: number): Reminder | null {
  const intervalMinutes = Math.min(Math.round(minutes), MAX_MINUTES)
  if (!label.trim() || !(intervalMinutes >= 1)) return null
  return { id, label: label.trim(), intervalMinutes }
}

// A running session whose time has passed and has not been announced yet.
export const isDue = (session: Session, now: number): boolean =>
  session.endsAt !== null && !session.ended && timeLeft(session, now) === 0

// Time is up. The end time is kept: the menu bar shows 0:00 from it until
// the session is closed.
export const finish = (session: Session): Session => ({ ...session, remaining: null, ended: true })

// "10 more minutes" counts from the moment it is asked for, not from when the
// time ran out, which may have been a while ago.
// The time focused carries on from where it was, and the intervals reached so
// far count as said: one that fell on the end, where the end won, would
// otherwise be said the moment the extra minutes start.
export const extend = (session: Session, minutes: number, now: number): Session => ({
  ...session,
  endsAt: now + minutes * MINUTE,
  remaining: null,
  ended: false,
  total: session.total - timeLeft(session, now) + minutes * MINUTE,
  fired: [...new Set([...session.fired, ...reached(session, now).map((r) => r.key)])],
  reminding: null,
})

// The minutes field wins over the buttons when something is typed in it.
// Whole minutes: the field says minutes, and a fraction typed into it would
// carry into every time the session keeps, which the time sheet stores as
// whole milliseconds and would refuse.
export function chosenMinutes(typed: string, preset: number): number {
  const minutes = Math.round(Number(typed))
  return minutes >= 1 ? Math.min(minutes, MAX_MINUTES) : preset
}

// The tasks offered to focus on: today's goal first, then what is due today
// or overdue, then everything else.
export function focusTasks(tasks: Task[], today: Day): Task[] {
  const rank = (t: Task) => (t.goalDay === today ? 0 : t.due !== null && t.due <= today ? 1 : 2)
  return openTasks(tasks).sort((a, b) => rank(a) - rank(b) || byPriority(a, b))
}

// The length kept from last time, as storage holds it: text, or nothing.
// Anything that is not a whole length the field would accept is the default.
export function storedLength(text: string | null): number {
  const minutes = Number(text)
  return text !== null && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : DEFAULT_MINUTES
}

// One line saying what the Focus page's folded options hold, so they need
// not be opened to know. Empty when nothing is set.
export function optionsSummary(reminders: Reminder[], blocks: Block[]): string {
  const said: string[] = []
  if (reminders.length === 1) said.push(`${reminders[0].label} every ${reminders[0].intervalMinutes} min`)
  if (reminders.length > 1) said.push(`${reminders.length} reminders`)
  if (blocks.length) said.push(`${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'} up next`)
  return said.join(' · ')
}

// ---------- The time sheet and Up next ----------

// Time spent focusing so far. Pauses and reminder breaks are not in it (the
// clock was stopped), extra time asked for is.
export const focused = (session: Session, now: number): number => session.total - timeLeft(session, now)

// A block shorter than this is a false start, not work worth a row.
const SHORTEST = MINUTE

// The time sheet row for a session that is ending now, or null when it was
// too short to write down.
export function entryOf(session: Session, now: number): NewEntry | null {
  const focusedMs = focused(session, now)
  if (focusedMs < SHORTEST) return null
  // Rounded, because the tasks file keeps whole milliseconds and refuses a
  // fraction; a session stored by an older version may hold one.
  return {
    taskId: session.taskId,
    title: session.title,
    day: dayOf(new Date(session.startedAt)),
    startedAt: Math.round(session.startedAt),
    // Time ran out at the end time, however long the 0:00 was left showing
    // before Close was pressed. Paused, it ends now.
    endedAt: Math.round(session.endsAt !== null ? Math.min(now, session.endsAt) : now),
    plannedMs: Math.round(session.planned),
    focusedMs: Math.round(focusedMs),
  }
}

// A block for Up next, or null without a sensible length. The same check
// is used on what comes back from storage.
export function newBlock(id: string, task: Pick<Task, 'id' | 'title'> | null, minutes: number): Block | null {
  const length = Math.min(Math.round(minutes), MAX_MINUTES)
  if (!(length >= 1)) return null
  return { id, taskId: task ? task.id : null, title: task ? task.title : 'Focus', minutes: length }
}

// Moves a block up (by -1) or down (by 1) the list; at either end it stays.
export function moveBlock(blocks: Block[], id: string, by: -1 | 1): Block[] {
  const from = blocks.findIndex((b) => b.id === id)
  const to = from + by
  if (from < 0 || to < 0 || to >= blocks.length) return blocks
  const next = [...blocks]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

// What became of a queued block's task: still to do, finished, or deleted,
// perhaps on another device or by an agent while the block waited. A block
// on no task is always 'open'. `tasks` is every task, not a view's share:
// a task out of the current view is not gone.
export type BlockTask = 'open' | 'finished' | 'deleted'
export function blockTask(block: Block, tasks: Task[]): BlockTask {
  if (block.taskId === null) return 'open'
  const task = tasks.find((t) => t.id === block.taskId)
  return !task ? 'deleted' : task.done ? 'finished' : 'open'
}

// The block to start next: the first whose task is still to do. The ones
// before it, on tasks finished or deleted since, are skipped rather than
// run on no task under their old title; `skipped` lists them so they can be
// taken off the list too.
export function nextBlock(blocks: Block[], tasks: Task[]): { block: Block | null; skipped: Block[] } {
  const at = blocks.findIndex((b) => blockTask(b, tasks) === 'open')
  return at === -1 ? { block: null, skipped: blocks } : { block: blocks[at], skipped: blocks.slice(0, at) }
}

// The session for a queued block. Its task is used as it is now (renamed,
// perhaps); if it has been finished or deleted since it was queued, the
// block still runs under the title it was queued with, on no task, so the
// time sheet does not point at a task that is done.
export function startBlock(block: Block, tasks: Task[], now: number, reminders: Reminder[] = []): Session {
  const task = block.taskId === null ? undefined : openTasks(tasks).find((t) => t.id === block.taskId)
  const session = start(task ?? null, block.minutes, now, reminders)
  return task ? session : { ...session, title: block.title }
}
