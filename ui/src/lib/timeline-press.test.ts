import { describe, expect, it } from 'vitest'
import { HOLD_MS, IDLE, press, released, SLOP } from '@/lib/timeline-press'

const down = (pointer: string) => press(IDLE, { type: 'down', x: 100, y: 50, pointer })

describe('a press on a Timeline bar', () => {
  it('drags at once with a mouse, as on the Mac', () => {
    expect(down('mouse')).toEqual({ kind: 'dragging', x: 100, held: false })
  })

  it('waits for a hold with a finger or a pen, so a pan on a bar scrolls', () => {
    expect(down('touch')).toEqual({ kind: 'waiting', x: 100, y: 50 })
    expect(down('pen').kind).toBe('waiting')
    expect(HOLD_MS).toBeGreaterThanOrEqual(350)
    expect(HOLD_MS).toBeLessThanOrEqual(400)
  })

  it('lifts the bar when the finger is held still', () => {
    const held = press(down('touch'), { type: 'hold' })
    expect(held).toEqual({ kind: 'dragging', x: 100, held: true })
    // Small trembles before the hold do not count as a scroll.
    const trembled = press(down('touch'), { type: 'move', x: 100 + SLOP - 1, y: 50 })
    expect(trembled.kind).toBe('waiting')
  })

  it('leaves a finger that moves first to the browser, to scroll', () => {
    const scrolled = press(down('touch'), { type: 'move', x: 100, y: 50 + SLOP + 1 })
    expect(scrolled).toEqual({ kind: 'scrolling' })
    // A hold that fires after that changes nothing.
    expect(press(scrolled, { type: 'hold' })).toEqual({ kind: 'scrolling' })
  })

  it('ends on release or cancel', () => {
    expect(press(down('touch'), { type: 'up' })).toEqual(IDLE)
    expect(press(down('mouse'), { type: 'cancel' })).toEqual(IDLE)
  })
})

describe('what letting go of a bar does', () => {
  it('opens the task on a tap or a click', () => {
    expect(released(down('touch'), 0)).toBe('open')
    expect(released(down('mouse'), 0)).toBe('open')
  })

  it('moves it when it was dragged a day or more', () => {
    expect(released(press(down('touch'), { type: 'hold' }), 2)).toBe('move')
    expect(released(down('mouse'), -1)).toBe('move')
  })

  it('does nothing after a hold let go where it started, or after a scroll', () => {
    expect(released(press(down('touch'), { type: 'hold' }), 0)).toBe('nothing')
    expect(released({ kind: 'scrolling' }, 0)).toBe('nothing')
    expect(released(IDLE, 0)).toBe('nothing')
  })
})
