import { describe, expect, it } from 'vitest'
import { CLICK_WINDOW, swallowClick } from '@/lib/swallow-click'

// A window with only what swallowClick uses: click listeners and one timer.
function fakeWindow() {
  const listeners = new Set<EventListener>()
  let timer: (() => void) | null = null
  const target = {
    addEventListener: (_type: string, fn: EventListener) => listeners.add(fn),
    removeEventListener: (_type: string, fn: EventListener) => listeners.delete(fn),
    setTimeout: (fn: () => void, ms: number) => {
      expect(ms).toBe(CLICK_WINDOW)
      timer = fn
      return 1
    },
    clearTimeout: () => (timer = null),
  }
  const click = () => {
    const event = {
      stopped: false,
      prevented: false,
      stopPropagation() {
        this.stopped = true
      },
      preventDefault() {
        this.prevented = true
      },
    }
    for (const fn of [...listeners]) fn(event as unknown as Event)
    return event
  }
  return { target: target as unknown as Window, listeners, click, expire: () => timer?.() }
}

describe('the click after a held item is let go', () => {
  it('is eaten, and only that one', () => {
    const w = fakeWindow()
    swallowClick(w.target)
    const first = w.click()
    expect(first.stopped && first.prevented).toBe(true)
    expect(w.click().stopped).toBe(false)
    expect(w.listeners.size).toBe(0)
  })

  it('is not waited for forever', () => {
    const w = fakeWindow()
    swallowClick(w.target)
    w.expire()
    expect(w.listeners.size).toBe(0)
    expect(w.click().prevented).toBe(false)
  })
})
