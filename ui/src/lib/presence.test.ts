import { describe, expect, it } from 'vitest'
import { activityNow, faded, hereText, idleText, peopleHere, shouldTell, BEAT_EVERY, IDLE_AFTER } from '@/lib/presence'

const T = 1_800_000_000_000

describe('activity', () => {
  it('goes idle after a still minute, or at once when the window is hidden', () => {
    expect(activityNow(T, false, T + IDLE_AFTER - 1).idle).toBe(false)
    expect(activityNow(T, false, T + IDLE_AFTER).idle).toBe(true)
    expect(activityNow(T, true, T + 1).idle).toBe(true)
    expect(activityNow(T, false, T + 5).since).toBe(T)
  })

  it('tells the others at once on a change, and while active at most every ten seconds', () => {
    const active = { idle: false, since: T }
    expect(shouldTell(null, active, 0, T)).toBe(true)
    expect(shouldTell(active, { idle: true, since: T }, T, T + 1)).toBe(true)
    expect(shouldTell({ idle: true, since: T }, { idle: false, since: T + 2 }, T, T + 2)).toBe(true)
    expect(shouldTell(active, { idle: false, since: T + 5 }, T, T + BEAT_EVERY - 1)).toBe(false)
    expect(shouldTell(active, { idle: false, since: T + 5 }, T, T + BEAT_EVERY)).toBe(true)
    // Idle stays idle: nothing more to say until they come back.
    expect(shouldTell({ idle: true, since: T }, { idle: true, since: T }, T, T + 10 * BEAT_EVERY)).toBe(false)
  })

  it('says how long someone has been idle, plainly', () => {
    const since = (minutes: number) => ({ idle: true, since: T - minutes * 60_000 })
    expect(idleText('Geart', { idle: false, since: T }, T)).toBe('Geart, active now')
    expect(idleText('Geart', since(0.5), T)).toBe('Geart, idle')
    expect(idleText('Geart', since(1), T)).toBe('Geart, idle for 1 minute')
    expect(idleText('Geart', since(5), T)).toBe('Geart, idle for 5 minutes')
    expect(idleText('Geart', since(61), T)).toBe('Geart, idle for 1 hour')
    expect(idleText('Geart', since(185), T)).toBe('Geart, idle for 3 hours')
    // Another machine's clock a little ahead never makes a negative time.
    expect(idleText('Geart', { idle: true, since: T + 30_000 }, T)).toBe('Geart, idle')
  })
})

describe('people here', () => {
  const user = (account: string, name: string) => ({ account, name, picture: '', color: '#2f9a5c' })
  it('shows each person once, leaves you out, and puts the active first', () => {
    const states = new Map<number, unknown>([
      [1, { user: user('1001', 'Julius Olsson'), activity: { idle: false, since: T } }],
      [2, { user: user('1002', 'Geart'), activity: { idle: true, since: T - 300_000 } }],
      // Geart again, in a second window where he is typing.
      [3, { user: user('1002', 'Geart'), activity: { idle: false, since: T } }],
      [4, { user: user('1003', 'Ana Lind'), activity: { idle: true, since: T } }],
      [5, { user: user('1004', 'Bo'), activity: { idle: false, since: T } }],
      // A window that has not said who it is yet, and one that has left.
      [6, {}],
      [7, null],
    ])
    const here = peopleHere(states, '1001')
    expect(here.map((p) => [p.name, p.activity.idle])).toEqual([
      ['Bo', false],
      ['Geart', false],
      ['Ana Lind', true],
    ])
    expect(hereText(here)).toBe('Bo and 2 others are here')
    expect(hereText(here.slice(1, 2))).toBe('Geart is here')
    expect(hereText(here.slice(2))).toBe('Ana is idle')
    expect(hereText(here.slice(0, 2))).toBe('Bo and Geart are here')
    expect(hereText([])).toBe('')
  })

  it('fades a colour for an idle cursor', () => {
    expect(faded('#2f9a5c')).toBe('#2f9a5c66')
    expect(faded('var(--x)')).toBe('var(--x)')
  })
})
