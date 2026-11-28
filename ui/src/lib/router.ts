// The browser's history, kept in step with where the app is (lib/route.ts
// decides each step). The window is passed in so the tests can hand it a
// history of their own.
import { formatRoute as formatPath, parseRoute, stepTo, type Entry, type Route } from '@/lib/route'

export interface Win {
  history: Pick<History, 'state' | 'pushState' | 'replaceState' | 'back'>
  location: Pick<Location, 'pathname' | 'search'>
  addEventListener(type: 'popstate', listener: () => void): void
  removeEventListener(type: 'popstate', listener: () => void): void
}

// What each entry the app made keeps: where it was pushed from, and whether
// it is opened over that one. Marked, so another page's state is not read as ours.
interface State {
  done: 1
  prev: string | null
  over: boolean
}
const isState = (s: unknown): s is State =>
  typeof s === 'object' && s !== null && (s as State).done === 1 && (typeof (s as State).prev === 'string' || (s as State).prev === null)

export function createRouter(win: Win) {
  // Waiting for the browser to finish going back to close something. What
  // the app asks for meanwhile is done once it has.
  let popping: ReturnType<typeof setTimeout> | null = null
  let waiting: { route: Route; replace: boolean } | null = null

  const entry = (): Entry => {
    const path = win.location.pathname + win.location.search
    const state = win.history.state
    return isState(state) ? { path, prev: state.prev, over: state.over === true } : { path, prev: null, over: false }
  }
  const write = (how: 'pushState' | 'replaceState', e: Entry) => win.history[how]({ done: 1, prev: e.prev, over: e.over } satisfies State, '', e.path)

  const settle = () => {
    if (popping) clearTimeout(popping)
    popping = null
    const next = waiting
    waiting = null
    if (next) go(next.route, next.replace)
  }

  // Take the browser to `route`, the place the app now shows.
  function go(route: Route, replace = false) {
    if (popping) {
      waiting = { route, replace }
      return
    }
    const step = stepTo(entry(), route, replace)
    if (step.kind === 'push') write('pushState', step.entry)
    if (step.kind === 'replace') write('replaceState', step.entry)
    if (step.kind === 'back') {
      // A popstate always follows; the timer is only a guard against one
      // that never comes, so the app can never be stuck waiting.
      popping = setTimeout(settle, 1000)
      win.history.back()
    }
  }

  return {
    entry,
    go,
    // The place the address names now, written the one way it is written,
    // keeping the entry's way back. Null if the address is not a place.
    start(route: Route) {
      const e = entry()
      write('replaceState', { ...e, path: formatPath(route) })
    },
    // A Back the person asked for (a phone's Back button or edge swipe): the
    // browser goes back when there is an entry of the app's behind this one.
    // When there is none it would leave the app, so the fallback takes this
    // entry instead and is returned for the app to show.
    back(fallback: Route): Route | null {
      if (entry().prev !== null) {
        win.history.back()
        return null
      }
      write('replaceState', { path: formatPath(fallback), prev: null, over: false })
      return fallback
    },
    // The browser moved through its history (Back, Forward, or a phone's
    // Back above). Not called for the steps back the router took itself.
    listen(moved: (route: Route | null, entry: Entry) => void): () => void {
      const onPop = () => {
        if (popping) return settle()
        const e = entry()
        moved(parseRoute(e.path), e)
      }
      win.addEventListener('popstate', onPop)
      return () => win.removeEventListener('popstate', onPop)
    },
  }
}
