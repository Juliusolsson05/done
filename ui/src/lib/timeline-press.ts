// A press on a Timeline bar, from pointerdown to release. With a mouse the
// bar moves at once, as on the Mac. With a finger (or a pen) the same press
// usually means "scroll": the bar only lifts after the finger is held still
// for HOLD_MS, and a finger that moves first is left to the browser to
// scroll the chart. Plain data in, plain data out; the timer and the
// pointer events live in the component.

// Long enough not to catch a slow pan, short enough not to feel like a wait
// (iOS's own long press is about half a second).
export const HOLD_MS = 380
// How far a finger may tremble during the hold before it counts as a scroll.
export const SLOP = 8

export type PressState =
  | { kind: 'idle' }
  | { kind: 'waiting'; x: number; y: number }
  // `held`: lifted by a hold, rather than taken by a mouse.
  | { kind: 'dragging'; x: number; held: boolean }
  | { kind: 'scrolling' }

export type PressEvent =
  | { type: 'down'; x: number; y: number; pointer: string }
  | { type: 'move'; x: number; y: number }
  | { type: 'hold' }
  | { type: 'up' }
  | { type: 'cancel' }

export const IDLE: PressState = { kind: 'idle' }

export function press(state: PressState, event: PressEvent): PressState {
  switch (event.type) {
    case 'down':
      return event.pointer === 'mouse' ? { kind: 'dragging', x: event.x, held: false } : { kind: 'waiting', x: event.x, y: event.y }
    case 'move':
      if (state.kind === 'waiting' && Math.hypot(event.x - state.x, event.y - state.y) > SLOP) return { kind: 'scrolling' }
      return state
    case 'hold':
      return state.kind === 'waiting' ? { kind: 'dragging', x: state.x, held: true } : state
    case 'up':
    case 'cancel':
      return IDLE
  }
}

// What letting go does, given the state before the release and the whole
// days the bar was dragged. A tap or a click opens the task; a hold let go
// where it started was a change of mind, and opens nothing.
export function released(state: PressState, days: number): 'open' | 'move' | 'nothing' {
  if (state.kind === 'waiting') return 'open'
  if (state.kind !== 'dragging') return 'nothing'
  if (days !== 0) return 'move'
  return state.held ? 'nothing' : 'open'
}

// Whole days a bar is dragged by, from how far the pointer went (`dx`) at
// `px` a day. Counted from past SLOP: at Quarter (4 px a day) or Month a
// tremble on letting go would otherwise move the task a day, and counting
// from the start would make the first step at Quarter two days. An end is
// never pulled past the other end: `length` is the bar's days.
export function daysDragged(dx: number, px: number, mode: 'move' | 'start' | 'end', length: number): number {
  if (Math.abs(dx) <= SLOP) return 0
  const moved = Math.sign(dx) * Math.round((Math.abs(dx) - SLOP) / px)
  if (mode === 'end') return Math.max(moved, 1 - length)
  if (mode === 'start') return Math.min(moved, length - 1)
  return moved
}
