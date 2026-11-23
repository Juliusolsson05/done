// Asking to move a project into another space. The question is asked from
// Settings and from a project's right-click menu; one dialog answers it
// (components/move-project.tsx), naming who gains or loses it first.
import { useSyncExternalStore } from 'react'

export interface MoveAsk {
  project: number
  to: number
}

let asked: MoveAsk | null = null
const listeners = new Set<() => void>()

export function askMove(ask: MoveAsk | null) {
  asked = ask
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useMoveAsk = (): MoveAsk | null =>
  useSyncExternalStore(
    subscribe,
    () => asked,
    () => asked,
  )
