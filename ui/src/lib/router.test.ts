import { describe, expect, it, vi } from 'vitest'
import type { Route } from '@/lib/route'
import { createRouter, type Win } from '@/lib/router'

// A browser's history as the spec describes it: push drops what is ahead,
// and Back arrives later as a popstate.
function browser(start: string) {
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }]
  let at = 0
  const listeners = new Set<() => void>()
  const here = () => new URL(entries[at].url, 'https://thedone.app')
  const win: Win = {
    history: {
      get state() {
        return entries[at].state
      },
      pushState(state: unknown, _t: string, url?: string | URL | null) {
        entries.splice(at + 1)
        entries.push({ url: String(url), state })
        at += 1
      },
      replaceState(state: unknown, _t: string, url?: string | URL | null) {
        entries[at] = { url: String(url), state }
      },
      back() {
        // Leaving the app altogether is recorded, never done.
        if (at === 0) return void (left = true)
        setTimeout(() => {
          at -= 1
          for (const l of listeners) l()
        }, 5)
      },
    },
    location: {
      get pathname() {
        return here().pathname
      },
      get search() {
        return here().search
      },
    },
    addEventListener: (_type, l) => listeners.add(l),
    removeEventListener: (_type, l) => listeners.delete(l),
  }
  let left = false
  const forward = () => {
    at += 1
    for (const l of listeners) l()
  }
  return { win, urls: () => entries.map((e) => e.url), at: () => at, left: () => left, forward }
}

const view = (kind: 'today' | 'upcoming' | 'focus' | 'lists', task: number | null = null): Route => ({ view: { kind }, task })
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('router', () => {
  it('keeps where a page was scrolled in its own entry, for Back', async () => {
    const b = browser('/lists')
    const router = createRouter(b.win)
    router.listen(() => {})
    expect(router.scrollOf()).toBeNull()
    router.keepScroll(300)
    router.go(view('focus'))
    expect(router.scrollOf()).toBeNull()
    b.win.history.back()
    await settled()
    expect(router.scrollOf()).toBe(300)
  })

  it('closes an open task by going back, so Back does not reopen it and Forward does', async () => {
    const b = browser('/today')
    const router = createRouter(b.win)
    const moved = vi.fn()
    router.listen(moved)
    router.go(view('today', 3))
    expect(b.urls()).toEqual(['/today', '/today?task=3'])
    router.go(view('today'))
    await settled()
    expect(b.at()).toBe(0)
    expect(b.urls()).toEqual(['/today', '/today?task=3'])
    // Its own step back is not reported as the person moving.
    expect(moved).not.toHaveBeenCalled()
    b.forward()
    expect(moved).toHaveBeenCalledWith(view('today', 3), { path: '/today?task=3', prev: '/today', over: true })
  })

  it('does what was asked while it was going back, once it has', async () => {
    const b = browser('/today')
    const router = createRouter(b.win)
    router.listen(() => {})
    router.go(view('today', 3))
    router.go(view('today'))
    router.go(view('upcoming'))
    await settled()
    expect(b.urls()).toEqual(['/today', '/upcoming'])
    expect(b.at()).toBe(1)
  })

  it('reports Back from the browser, with where it is now', async () => {
    const b = browser('/today')
    const router = createRouter(b.win)
    const moved = vi.fn()
    router.listen(moved)
    router.go(view('upcoming'))
    b.win.history.back()
    await settled()
    expect(moved).toHaveBeenCalledWith(view('today'), { path: '/today', prev: null, over: false })
  })

  it('goes back on a phone’s Back when there is somewhere to go', async () => {
    const b = browser('/lists')
    const router = createRouter(b.win)
    router.go(view('focus'))
    expect(router.back(view('lists'))).toBeNull()
    await settled()
    expect(b.at()).toBe(0)
    expect(b.left()).toBe(false)
  })

  it('never leaves the app on a phone’s Back from a page loaded on its own', () => {
    const b = browser('/focus')
    const router = createRouter(b.win)
    expect(router.back(view('lists'))).toEqual(view('lists'))
    expect(b.urls()).toEqual(['/lists'])
    expect(b.left()).toBe(false)
    // And again: Lists has nothing behind it either, and stays.
    expect(router.back(view('lists'))).toEqual(view('lists'))
    expect(b.urls()).toEqual(['/lists'])
  })

  it('is not stuck if a popstate never comes', async () => {
    vi.useFakeTimers()
    const b = browser('/today')
    const router = createRouter(b.win)
    router.go(view('today', 3))
    // A history that swallows the Back.
    b.win.history.back = () => {}
    router.go(view('today'))
    router.go(view('focus'))
    vi.advanceTimersByTime(1000)
    expect(b.urls().at(-1)).toBe('/focus')
    vi.useRealTimers()
  })

  it('ignores state another page left in the history', () => {
    const b = browser('/today')
    b.win.history.replaceState({ prev: '/elsewhere', over: true }, '', '/today')
    expect(createRouter(b.win).entry()).toEqual({ path: '/today', prev: null, over: false })
  })
})
