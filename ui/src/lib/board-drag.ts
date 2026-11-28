// A card held on the Board scrolls what it is held near: the column under
// the finger near its top or bottom, the columns themselves near the left or
// right edge on a phone. Nothing moves until the finger is within EDGE
// pixels of an edge; from there it goes faster the closer it gets, up to
// MAX_STEP pixels a frame. Plain numbers in, plain numbers out.

export const EDGE = 32
export const MAX_STEP = 14

// How far to scroll this frame, for a finger at `at` in a box from `start`
// to `end` along one axis: negative toward the start, positive toward the
// end, 0 in the middle. A finger past the edge scrolls at full speed.
export function edgeStep(at: number, start: number, end: number): number {
  const fromStart = at - start
  const fromEnd = end - at
  // A box too small to have a middle scrolls toward the nearer edge only.
  if (fromStart < EDGE && fromStart <= fromEnd) return -speed(fromStart)
  if (fromEnd < EDGE) return speed(fromEnd)
  return 0
}

const speed = (distance: number) => Math.max(1, Math.round(MAX_STEP * (1 - Math.max(0, distance) / EDGE)))
