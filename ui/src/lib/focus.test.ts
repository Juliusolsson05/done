import { describe, expect, it } from 'vitest'
import { chosenMinutes, clockText, extend, finish, focusTasks, isDue, start, timeLeft, toggle } from '@/lib/focus'
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
