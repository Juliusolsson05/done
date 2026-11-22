// The taps an iPhone gives under your finger. They come from the system
// through Tauri's haptics plugin, so only the iPhone app has them; on a Mac
// or in a browser `feel` does nothing.
import type { SoundName } from '@/lib/sounds'

type Feel = { impact: 'light' | 'medium' | 'rigid' | 'soft' } | { notification: 'success' | 'warning' | 'error' } | 'selection'

// Which of the app's moments are felt, and how. As with the sounds, the
// rewards are the strongest: finishing a task is a firm tap, finishing the
// last one or a focus block is the system's success pattern.
export const FEELS: Partial<Record<SoundName, Feel>> = {
  complete: { impact: 'medium' },
  completeBig: { notification: 'success' },
  focusDone: { notification: 'success' },
  focusStart: { impact: 'soft' },
  add: { impact: 'light' },
  reopen: { impact: 'light' },
  delete: { impact: 'rigid' },
  undo: { impact: 'light' },
  drop: 'selection',
  error: { notification: 'error' },
}

interface Invoke {
  core: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
}
// Looked up when used rather than when loaded, so this file also loads where
// there is no window at all (the tests).
const tauri = () => (globalThis as unknown as { __TAURI__?: Invoke }).__TAURI__
// The plugin is in the iPhone app only. Asked of the platform rather than the
// screen width: a narrow Mac window has no haptics.
const onPhone = () => tauri() !== undefined && /iPhone|iPad/.test(globalThis.navigator?.userAgent ?? '')

export function feel(feel: Feel | undefined) {
  if (!feel || !onPhone()) return
  const { invoke } = tauri()!.core
  const call =
    feel === 'selection'
      ? invoke('plugin:haptics|selection_feedback')
      : 'impact' in feel
        ? invoke('plugin:haptics|impact_feedback', { style: feel.impact })
        : invoke('plugin:haptics|notification_feedback', { type: feel.notification })
  // A tap that does not happen is never worth an error.
  call.catch(() => undefined)
}

// A light tick for a choice, such as a swipe passing the point where letting
// go would act.
export const tick = () => feel('selection')
