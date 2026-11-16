import { describe, expect, it } from 'vitest'
import {
  chosenMinutes,
  clockText,
  dismiss,
  dueReminder,
  entryOf,
  extend,
  finish,
  fire,
  focusTasks,
  moveBlock,
  newBlock,
  startBlock,
  isDue,
  newReminder,
  nextReminderAt,
  start,
  timeLeft,
  toggle,
  type Block,
  type Reminder,
  type Session,
} from '@/lib/focus'
import type { Task } from '@/lib/tasks'

const MINUTE = 60000
// Any moment will do; nothing here reads the real clock.
const t0 = Date.UTC(2026, 10, 14, 9, 0, 0)
const task = (id: number, fields: Partial<Task> = {}): Task => ({
  id,
  title: 'Task ' + id,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  ...fields,
})

describe('the clock', () => {
  it('reads 25:00 for a fresh 25 minutes, not 24:59', () => {
    const session = start(null, 25, t0)
    expect(clockText(timeLeft(session, t0))).toBe('25:00')
    // A tick later the seconds are still rounded up.
    expect(clockText(timeLeft(session, t0 + 250))).toBe('25:00')
    expect(clockText(timeLeft(session, t0 + 1000))).toBe('24:59')
  })

  it('shows hours from an hour up', () => {
    expect(clockText(59 * MINUTE + 59000)).toBe('59:59')
    expect(clockText(60 * MINUTE)).toBe('1:00:00')
    expect(clockText(timeLeft(start(null, 90, t0), t0 + 25 * MINUTE + 1000))).toBe('1:04:59')
  })

  it('reaches 0:00 only when the time is really up', () => {
    expect(clockText(1)).toBe('0:01')
    expect(clockText(0)).toBe('0:00')
  })
})

describe('a session', () => {
  it('takes the task it was started on, or none', () => {
    expect(start(task(7, { title: 'write the report' }), 25, t0)).toMatchObject({ taskId: 7, title: 'write the report' })
    expect(start(null, 25, t0)).toMatchObject({ taskId: null, title: 'Focus' })
  })

  it('counts down from its end time, however long ago the last look was', () => {
    const session = start(null, 25, t0)
    // As after the Mac slept: no ticks in between, and the time is still right.
    expect(timeLeft(session, t0 + 20 * MINUTE)).toBe(5 * MINUTE)
  })

  it('has nothing left once its end has passed', () => {
    const session = start(null, 25, t0)
    expect(timeLeft(session, t0 + 25 * MINUTE)).toBe(0)
    expect(timeLeft(session, t0 + 3 * 60 * MINUTE)).toBe(0)
    expect(timeLeft(null, t0)).toBe(0)
  })

  it('keeps the time left when paused and resumed later', () => {
    const paused = toggle(start(null, 25, t0), t0 + 10 * MINUTE)
    expect(paused).toMatchObject({ endsAt: null, remaining: 15 * MINUTE })
    // An hour in pause costs nothing.
    expect(timeLeft(paused, t0 + 70 * MINUTE)).toBe(15 * MINUTE)

    const resumed = toggle(paused, t0 + 70 * MINUTE)
    expect(resumed).toMatchObject({ endsAt: t0 + 85 * MINUTE, remaining: null })
    expect(timeLeft(resumed, t0 + 71 * MINUTE)).toBe(14 * MINUTE)
  })

  it('is due once, when a running session runs out', () => {
    const session = start(null, 1, t0)
    expect(isDue(session, t0 + MINUTE - 1)).toBe(false)
    expect(isDue(session, t0 + MINUTE)).toBe(true)
    // Paused, the end never comes.
    expect(isDue(toggle(session, t0 + 30000), t0 + 5 * MINUTE)).toBe(false)
    // Once announced it is not announced again.
    expect(isDue(finish(session), t0 + 2 * MINUTE)).toBe(false)
  })

  it('stays at zero with its end time once ended, and cannot be paused', () => {
    const ended = finish(start(null, 1, t0))
    // The menu bar shows 0:00 from the end time until the session is closed.
    expect(ended).toMatchObject({ endsAt: t0 + MINUTE, remaining: null, ended: true })
    expect(timeLeft(ended, t0 + 5 * MINUTE)).toBe(0)
    expect(toggle(ended, t0 + 5 * MINUTE)).toBe(ended)
  })

  it('gives ten more minutes from now, not from when the time ran out', () => {
    const ended = finish(start(task(7), 25, t0))
    const later = t0 + 40 * MINUTE
    const more = extend(ended, 10, later)
    expect(more).toMatchObject({ taskId: 7, endsAt: later + 10 * MINUTE, ended: false })
    expect(clockText(timeLeft(more, later))).toBe('10:00')
    expect(isDue(more, later)).toBe(false)
  })
})

describe('reminders', () => {
  const stretch: Reminder = { id: 'a', label: 'Stand up and stretch', intervalMinutes: 10 }
  const water: Reminder = { id: 'b', label: 'Drink water', intervalMinutes: 5 }
  // What the app does on every look at the clock: fire the reminder that is due, if any.
  const look = (session: Session, now: number): Session => {
    const due = dueReminder(session, now)
    return due ? fire(session, due, now) : session
  }

  it('fires once when its interval is crossed, and pauses the session', () => {
    const session = start(null, 25, t0, [stretch])
    expect(dueReminder(session, t0 + 10 * MINUTE - 1)).toBeNull()
    expect(dueReminder(session, t0 + 10 * MINUTE)).toBe(stretch)

    const reminding = look(session, t0 + 10 * MINUTE)
    expect(reminding).toMatchObject({ reminding: stretch, endsAt: null, remaining: 15 * MINUTE })
    // Held until dismissed: nothing else becomes due, however long it takes.
    expect(dueReminder(reminding, t0 + 60 * MINUTE)).toBeNull()

    const resumed = dismiss(reminding, t0 + 12 * MINUTE)
    expect(resumed.reminding).toBeNull()
    // The same interval does not fire again, a tick or minutes later.
    expect(dueReminder(resumed, t0 + 12 * MINUTE + 250)).toBeNull()
    expect(dueReminder(resumed, t0 + 20 * MINUTE)).toBeNull()
    // The next one comes after ten more minutes of focus: 2 were spent in the reminder.
    expect(dueReminder(resumed, t0 + 22 * MINUTE - 1)).toBeNull()
    expect(dueReminder(resumed, t0 + 22 * MINUTE)).toBe(stretch)
  })

  it('fires a missed one exactly once when the look at the clock comes late', () => {
    const session = start(null, 60, t0, [stretch])
    // As after sleep: the first look comes at 27 minutes, past two intervals.
    const late = t0 + 27 * MINUTE
    const reminding = look(session, late)
    expect(reminding.reminding).toBe(stretch)
    const resumed = dismiss(reminding, late)
    // One reminder for the two missed, not two in a row.
    expect(dueReminder(resumed, late + 250)).toBeNull()
    expect(dueReminder(resumed, late + 3 * MINUTE)).toBe(stretch)
  })

  it('does not fire again after a pause and resume', () => {
    const fired = dismiss(look(start(null, 25, t0, [stretch]), t0 + 10 * MINUTE), t0 + 10 * MINUTE)
    const paused = toggle(fired, t0 + 11 * MINUTE)
    expect(dueReminder(paused, t0 + 40 * MINUTE)).toBeNull()
    const resumed = toggle(paused, t0 + 40 * MINUTE)
    expect(dueReminder(resumed, t0 + 40 * MINUTE)).toBeNull()
    // 11 minutes of focus so far; the second interval is 9 minutes of focus away.
    expect(dueReminder(resumed, t0 + 49 * MINUTE - 1)).toBeNull()
    expect(dueReminder(resumed, t0 + 49 * MINUTE)).toBe(stretch)
  })

  it('does not count the time spent in a reminder as focus time', () => {
    const at = t0 + 10 * MINUTE
    const reminding = look(start(null, 25, t0, [stretch]), at)
    expect(timeLeft(reminding, at)).toBe(15 * MINUTE)
    // Seven minutes of stretching later, the same is left, before and after continuing.
    expect(timeLeft(reminding, at + 7 * MINUTE)).toBe(15 * MINUTE)
    const resumed = dismiss(reminding, at + 7 * MINUTE)
    expect(timeLeft(resumed, at + 7 * MINUTE)).toBe(15 * MINUTE)
    expect(resumed.endsAt).toBe(at + 22 * MINUTE)
  })

  it('handles two that are due at once one after the other, losing neither', () => {
    const at = t0 + 10 * MINUTE
    const first = look(start(null, 25, t0, [stretch, water]), at)
    expect(first.reminding).toBe(stretch)
    // Continuing brings up the other at once, and then nothing.
    const second = look(dismiss(first, at + MINUTE), at + MINUTE)
    expect(second.reminding).toBe(water)
    const resumed = dismiss(second, at + 2 * MINUTE)
    expect(dueReminder(resumed, at + 2 * MINUTE)).toBeNull()
    expect(timeLeft(resumed, at + 2 * MINUTE)).toBe(15 * MINUTE)
  })

  it('lets the end of the session win over a reminder due at the same moment', () => {
    const session = start(null, 10, t0, [stretch])
    expect(dueReminder(session, t0 + 10 * MINUTE)).toBeNull()
    expect(isDue(session, t0 + 10 * MINUTE)).toBe(true)
    // Nor once it has ended, however late that is noticed.
    expect(dueReminder(finish(session), t0 + 30 * MINUTE)).toBeNull()
  })

  it('does not bring old reminders back with ten more minutes', () => {
    // 20 minutes: the reminder fired at 10 and would be due at 20, where the end won.
    const fired = dismiss(look(start(null, 20, t0, [stretch]), t0 + 10 * MINUTE), t0 + 10 * MINUTE)
    const later = t0 + 45 * MINUTE
    const more = extend(finish(fired), 10, later)
    expect(dueReminder(more, later)).toBeNull()
    expect(dueReminder(more, later + 10 * MINUTE - 1)).toBeNull()

    // 25 minutes of focus, then ten more: the third interval is five minutes in.
    const longer = extend(finish(start(null, 25, t0, [stretch])), 10, later)
    expect(dueReminder(longer, later + 5 * MINUTE - 1)).toBeNull()
    expect(dueReminder(longer, later + 5 * MINUTE)).toBe(stretch)
  })

  it('is dismissed by pause or resume, as the menu bar and the space bar do it', () => {
    const reminding = look(start(null, 25, t0, [stretch]), t0 + 10 * MINUTE)
    expect(toggle(reminding, t0 + 11 * MINUTE)).toEqual(dismiss(reminding, t0 + 11 * MINUTE))
    // With no reminder showing there is nothing to dismiss.
    const running = start(null, 25, t0, [stretch])
    expect(dismiss(running, t0 + MINUTE)).toBe(running)
  })

  it('knows when the next one comes, for the menu bar to wake the window', () => {
    const session = start(null, 25, t0, [stretch, water])
    expect(nextReminderAt(session, t0)).toBe(t0 + 5 * MINUTE)
    // One that is already due is due now.
    expect(nextReminderAt(session, t0 + 6 * MINUTE)).toBe(t0 + 6 * MINUTE)
    // Paused or reminding, none is coming.
    expect(nextReminderAt(look(session, t0 + 5 * MINUTE), t0 + 5 * MINUTE)).toBeNull()
    // None at or after the end, and none without reminders.
    expect(nextReminderAt(start(null, 10, t0, [stretch]), t0)).toBeNull()
    expect(nextReminderAt(start(null, 25, t0), t0)).toBeNull()
  })

  it('needs a label and an interval of 1 to 600 whole minutes', () => {
    expect(newReminder('id', '  Stand up  ', 30)).toEqual({ id: 'id', label: 'Stand up', intervalMinutes: 30 })
    expect(newReminder('id', '   ', 30)).toBeNull()
    expect(newReminder('id', 'Stand up', 0)).toBeNull()
    expect(newReminder('id', 'Stand up', Number.NaN)).toBeNull()
    expect(newReminder('id', 'Stand up', 9999)?.intervalMinutes).toBe(600)
    expect(newReminder('id', 'Stand up', 2.4)?.intervalMinutes).toBe(2)
  })
})

describe('choosing', () => {
  it('lets the minutes field win over the buttons, up to ten hours', () => {
    expect(chosenMinutes('', 25)).toBe(25)
    expect(chosenMinutes('50', 25)).toBe(50)
    expect(chosenMinutes('9999', 25)).toBe(600)
    expect(chosenMinutes('0', 25)).toBe(25)
    expect(chosenMinutes('-5', 25)).toBe(25)
  })

  it('offers the goal first, then what is due or overdue, then the rest, leaving out finished tasks', () => {
    const today = '2026-11-14'
    const tasks = [
      task(1),
      task(2, { due: '2026-11-20' }),
      task(3, { due: today }),
      task(4, { due: '2026-11-10', priority: 1 }),
      task(5, { due: today, goalDay: today }),
      task(6, { due: today, done: true }),
    ]
    expect(focusTasks(tasks, today).map((t) => t.id)).toEqual([5, 4, 3, 1, 2])
  })
})

describe('the time sheet row a block leaves', () => {
  it('keeps the planned length and counts asked-for time as time taken', () => {
    // 25 minutes planned, ran out, then 15 more minutes asked for 5 minutes later.
    let session = finish(start(task(3, { title: 'write the report' }), 25, t0))
    session = extend(session, 15, t0 + 30 * MINUTE)
    const row = entryOf(session, t0 + 45 * MINUTE)
    expect(row).toMatchObject({ taskId: 3, title: 'write the report', plannedMs: 25 * MINUTE, focusedMs: 40 * MINUTE, startedAt: t0 })
  })

  it('leaves out a pause and a reminder break', () => {
    const stretch: Reminder = { id: 'r', label: 'Stretch', intervalMinutes: 10 }
    let session = start(null, 30, t0, [stretch])
    session = toggle(session, t0 + 5 * MINUTE) // paused for 7 minutes
    session = toggle(session, t0 + 12 * MINUTE)
    // The reminder is due 10 focused minutes in, at 17 minutes on the clock.
    session = fire(session, stretch, t0 + 17 * MINUTE)
    session = dismiss(session, t0 + 20 * MINUTE) // a 3 minute break
    expect(entryOf(session, t0 + 25 * MINUTE)?.focusedMs).toBe(15 * MINUTE)
  })

  it('ends when the time ran out, not when Close was pressed later', () => {
    const session = finish(start(null, 25, t0))
    expect(entryOf(session, t0 + 60 * MINUTE)).toMatchObject({ endedAt: t0 + 25 * MINUTE, focusedMs: 25 * MINUTE })
  })

  // The tasks file stores whole milliseconds and refuses a fraction, which
  // used to lose a block started from "33.3" typed in the minutes field.
  it('holds whole numbers, whatever was typed for the length', () => {
    const session = start(null, chosenMinutes('33.3', 25), t0 + 0.5)
    const row = entryOf(session, t0 + 40 * MINUTE) as NonNullable<ReturnType<typeof entryOf>>
    for (const value of [row.startedAt, row.endedAt, row.plannedMs, row.focusedMs]) expect(Number.isInteger(value)).toBe(true)
    expect(row.plannedMs).toBe(33 * MINUTE)
  })

  it('is not written for a false start under a minute', () => {
    expect(entryOf(start(null, 25, t0), t0 + 59 * 1000)).toBeNull()
    expect(entryOf(start(null, 25, t0), t0 + MINUTE)).not.toBeNull()
  })

  it('is on the local day the block started, even if it ran past midnight', () => {
    const lateEvening = new Date(2026, 10, 16, 23, 50).getTime()
    expect(entryOf(start(null, 25, lateEvening), lateEvening + 25 * MINUTE)?.day).toBe('2026-11-16')
  })
})

describe('Up next', () => {
  const blocks = ['a', 'b', 'c'].map((id) => newBlock(id, null, 15) as Block)

  it('refuses a block without a sensible length and caps a long one', () => {
    expect(newBlock('x', null, 0)).toBeNull()
    expect(newBlock('x', null, Number.NaN)).toBeNull()
    expect(newBlock('x', task(4, { title: 'call the bank' }), 900)).toEqual({ id: 'x', taskId: 4, title: 'call the bank', minutes: 600 })
  })

  it('moves a block up or down and leaves it at either end', () => {
    expect(moveBlock(blocks, 'c', -1).map((b) => b.id)).toEqual(['a', 'c', 'b'])
    expect(moveBlock(blocks, 'a', 1).map((b) => b.id)).toEqual(['b', 'a', 'c'])
    expect(moveBlock(blocks, 'a', -1)).toBe(blocks)
    expect(moveBlock(blocks, 'c', 1)).toBe(blocks)
  })

  it('starts a block on its task as it is now, for the length estimated', () => {
    const block = newBlock('x', task(4, { title: 'call the bank' }), 15) as Block
    const session = startBlock(block, [task(4, { title: 'call the bank about the loan' })], t0)
    expect(session).toMatchObject({ taskId: 4, title: 'call the bank about the loan', planned: 15 * MINUTE, startedAt: t0 })
    expect(timeLeft(session, t0)).toBe(15 * MINUTE)
  })

  it('runs a block whose task was finished meanwhile under its title, on no task', () => {
    const block = newBlock('x', task(4, { title: 'call the bank' }), 15) as Block
    const finished = task(4, { title: 'call the bank', done: true, doneDay: '2026-11-16' })
    expect(startBlock(block, [finished], t0)).toMatchObject({ taskId: null, title: 'call the bank' })
    expect(startBlock(block, [], t0)).toMatchObject({ taskId: null, title: 'call the bank' })
  })
})
