// The focus session this window is running. Kept apart from the tasks: it is
// a few minutes of state for one window, remembered in the browser's storage
// so it survives a reload, and never saved to the tasks file.
import { play } from '@/lib/sounds'
import { recordEntry, showInMenuBar } from '@/lib/backend'
import {
  DEFAULT_MINUTES,
  dismiss,
  dueReminder,
  entryOf,
  extend,
  finish,
  fire,
  moveBlock,
  newBlock,
  newReminder,
  nextReminderAt,
  start,
  startBlock,
  toggle,
  MAX_MINUTES,
  type Block,
  type Reminder,
  type Session,
} from '@/lib/focus'
import type { Task } from '@/lib/tasks'
import type { NewEntry } from '@/lib/time-sheet'

const KEY = 'done-focus'
// The reminders are kept apart from the session: the list outlives it.
const REMINDERS_KEY = 'done-reminders'
// Up next: the blocks to do after this one. Kept with the session in this
// window's storage, because it is today's plan, not part of the tasks.
const UP_NEXT_KEY = 'done-up-next'
// Blocks that ended but could not be written to the time sheet yet (the web
// server was down, say). Kept until a write succeeds, so none is lost.
const UNSAVED_KEY = 'done-unsaved-entries'
// The length last chosen, so a length picked under "Other" is still the
// one chosen next time, after a reload too.
const MINUTES_KEY = 'done-focus-minutes'

export function storedMinutes(): number {
  try {
    const minutes = Math.round(Number(localStorage.getItem(MINUTES_KEY)))
    return minutes >= 1 && minutes <= MAX_MINUTES ? minutes : DEFAULT_MINUTES
  } catch {
    return DEFAULT_MINUTES
  }
}

export function rememberMinutes(minutes: number) {
  try {
    localStorage.setItem(MINUTES_KEY, String(minutes))
  } catch {
    // Storage may be full or blocked; the length is still chosen for now.
  }
}

function stored(): Session | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    // Only the shape is checked: whatever else is in storage is not a session.
    if (typeof value !== 'object' || value === null || !('title' in value) || !('endsAt' in value)) return null
    // A session stored before there were reminders has none.
    const session = { total: 0, reminders: [], fired: [], reminding: null, ...(value as Partial<Session>) } as Session
    // One stored before the time sheet has no start or planned length. Its
    // length so far stands in for both, which is the best that is known.
    const startedAt = session.startedAt ?? (session.endsAt ?? Date.now()) - session.total
    return { ...session, startedAt, planned: session.planned ?? session.total }
  } catch {
    return null
  }
}

function storedReminders(): Reminder[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REMINDERS_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    // Each one goes through the same check as a new one, whatever is in storage.
    return value.flatMap((r: Partial<Reminder> | null) => newReminder(String(r?.id), String(r?.label ?? ''), Number(r?.intervalMinutes)) ?? [])
  } catch {
    return []
  }
}

function storedUpNext(): Block[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(UP_NEXT_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap((b: Partial<Block> | null) => {
      const task = typeof b?.taskId === 'number' ? { id: b.taskId, title: String(b.title ?? '') } : null
      const block = newBlock(String(b?.id), task, Number(b?.minutes))
      return block ? [{ ...block, title: String(b?.title || block.title) }] : []
    })
  } catch {
    return []
  }
}

let session: Session | null = stored()
let reminders: Reminder[] = storedReminders()
let upNext: Block[] = storedUpNext()

// Other tabs of the web app share this storage. Without following their
// changes, a session ended in one tab would live on in another and be
// written to the time sheet a second time when that one was closed.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) session = stored()
    else if (event.key === UP_NEXT_KEY) upNext = storedUpNext()
    else if (event.key === REMINDERS_KEY) reminders = storedReminders()
    else return
    for (const listener of listeners) listener()
  })
}
const listeners = new Set<() => void>()

export const subscribeFocus = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getFocus = (): Session | null => session
export const getReminders = (): Reminder[] => reminders
export const getUpNext = (): Block[] => upNext

function setReminders(next: Reminder[]) {
  reminders = next
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders))
  } catch {
    // Private windows may refuse storage; the list still stands until a reload.
  }
  for (const listener of listeners) listener()
}

// False when there was no label or no interval, and nothing was added.
export function addReminder(label: string, minutes: number): boolean {
  const reminder = newReminder(crypto.randomUUID(), label, minutes)
  if (reminder) setReminders([...reminders, reminder])
  return reminder !== null
}
export const removeReminder = (id: string): void => setReminders(reminders.filter((r) => r.id !== id))

function setUpNext(next: Block[]) {
  upNext = next
  try {
    localStorage.setItem(UP_NEXT_KEY, JSON.stringify(upNext))
  } catch {
    // Private windows may refuse storage; the list still stands until a reload.
  }
  for (const listener of listeners) listener()
}

// False when the length was not sensible, and nothing was added.
export function queueBlock(task: Task | null, minutes: number): boolean {
  const block = newBlock(crypto.randomUUID(), task, minutes)
  if (block) setUpNext([...upNext, block])
  return block !== null
}
export const unqueueBlock = (id: string): void => setUpNext(upNext.filter((b) => b.id !== id))
export const moveQueued = (id: string, by: -1 | 1): void => setUpNext(moveBlock(upNext, id, by))

// Told when a block has been written to the time sheet, so a sheet on screen
// can show it, and when writing it failed, so that can be said.
const recordedListeners = new Set<() => void>()
export const onRecorded = (listener: () => void) => {
  recordedListeners.add(listener)
  return () => recordedListeners.delete(listener)
}
let recordFailed: () => void = () => {}
export const onRecordFailed = (handler: () => void) => {
  recordFailed = handler
}

function storedUnsaved(): NewEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(UNSAVED_KEY) ?? '[]')
    return Array.isArray(value) ? (value as NewEntry[]) : []
  } catch {
    return []
  }
}
function setUnsaved(entries: NewEntry[]) {
  try {
    if (entries.length) localStorage.setItem(UNSAVED_KEY, JSON.stringify(entries))
    else localStorage.removeItem(UNSAVED_KEY)
  } catch {
    // Nowhere to keep them; the write is still tried once.
  }
}

// Writes the waiting blocks, oldest first, one at a time. Each is taken off
// the list only once it is written, and only one run goes at a time, so a
// block is neither lost nor sent twice by two runs overlapping.
let saving = false
async function saveUnsaved() {
  if (saving) return
  saving = true
  let wrote = false
  try {
    for (;;) {
      const [entry] = storedUnsaved()
      if (!entry) break
      await recordEntry(entry)
      setUnsaved(storedUnsaved().slice(1))
      wrote = true
    }
  } catch {
    recordFailed()
  } finally {
    saving = false
  }
  if (wrote) for (const listener of recordedListeners) listener()
}

// Writes down a session that is ending. Callers clear the session in the
// same step, which is what keeps a block from being written twice. It goes
// on the waiting list first, so it survives a failed write or a reload
// while the write is on its way.
function record(ending: Session | null) {
  const entry = ending && entryOf(ending, Date.now())
  if (!entry) return
  setUnsaved([...storedUnsaved(), entry])
  void saveUnsaved()
}

// Blocks left waiting by an earlier run are tried again when the app opens.
export const retryUnsaved = (): void => void saveUnsaved()

// Tells the menu bar. An ended session is still sent: the menu bar is what
// rings, and it shows 0:00 until the session is closed. Also called once at
// start-up, for a session that was running before a reload. During a
// reminder the session goes over as paused, so the menu bar's clock stops,
// and as reminding, which is what makes the menu bar ring.
export const handOff = (): void =>
  showInMenuBar(
    session && {
      endsAt: session.endsAt,
      remaining: session.remaining,
      reminderAt: nextReminderAt(session, Date.now()),
      reminding: session.reminding !== null,
      // For the Dynamic Island on a phone (the Mac's menu bar shows only time).
      title: session.title,
    },
  )

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

export const startFocus = (task: Task | null, minutes: number): void => {
  play('focusStart')
  set(start(task, minutes, Date.now(), reminders))
}
export const toggleFocus = (): void => set(session && toggle(session, Date.now()))
// Every way a session ends (Stop, Close, Finish task, the menu bar's Stop)
// comes through here, so every one of them is written to the time sheet.
// A block run all the way to its end is rewarded as it is closed; one
// stopped early is not. `reward` false when something else is about to make
// its own sound (Finish task plays the completion).
export function endFocus(reward: unknown = true): void {
  if (reward !== false && timeIsUp()) play('focusDone')
  const ending = session
  set(null)
  record(ending)
}

// Ends this block, if one is running, and starts the first one in Up next.
export function startNext(tasks: Task[]): void {
  const [block, ...rest] = upNext
  if (!block) return
  play(timeIsUp() ? 'focusDone' : 'focusStart')
  const ending = session
  setUpNext(rest)
  set(startBlock(block, tasks, Date.now(), reminders))
  record(ending)
}
export const moreFocus = (minutes: number): void => set(session && extend(session, minutes, Date.now()))
export const continueFocus = (): void => set(session && dismiss(session, Date.now()))

// Shows the reminder that is due, if one is, and returns it. Whether one is
// due is decided here and nowhere else; the menu bar only says when to look.
export function remind(): Reminder | null {
  const now = Date.now()
  const due = session && dueReminder(session, now)
  if (session && due) set(fire(session, due, now))
  return due
}

// Marks a session as ended. False when there was nothing to end, so the
// caller announces it only once.
export function timeIsUp(): boolean {
  if (!session || session.ended) return false
  set(finish(session))
  return true
}
