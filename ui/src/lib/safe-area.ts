// The safe area on the iPhone and iPad app, read from the window natively and
// handed to the styles as --native-safe-* on <html>; index.css makes them win
// over env() in --safe-*, which every inset uses.
//
// WHY: in done's iOS web view, env(safe-area-inset-*) keeps the portrait
// values when the iPhone is held sideways (top 62, sides 0 on an iPhone 17), so
// the start of every view sat under the Dynamic Island with an empty band at
// the top (#70). Safari on the same simulator gets the landscape values, and
// switching off the scroll view's inset adjustment changed nothing. Measured
// with a readout in the app: the window Tauri creates reports the same
// portrait values, so asking UIKit alone does not fix it either; `insetsFor`
// turns them the way iOS does (below). What the native answer still gives is
// the island's real size for each iPhone model, and the right values in
// portrait and on an iPad.
//
// When to ask: at start, and after every resize, because turning the phone
// resizes the window. The answer is asked again a moment later as well:
// UIKit updates the window's insets during the rotation animation, which can
// finish after the resize event has fired.

const SIDES = ['top', 'right', 'bottom', 'left'] as const

// What iOS reserves at the bottom of an iPhone held sideways: the home
// indicator's strip. Safari on the iPhone 17 simulator reports 20 pt; 21 is
// UIKit's documented landscape value on Face ID iPhones.
const LANDSCAPE_BOTTOM = 21

// The insets the page should use, from what the window reported.
//
// WHY the turning: held sideways, done's window still reports the portrait
// insets (iPhone 17 simulator, 24 Nov 2026: [62, 0, 34, 0] at 874×402 pt),
// and WebKit's env() says the same; the window Tauri creates is not told about
// the rotation the way a scene-based UIKit app is. Safari on the same
// simulator gets [0, 62, 20, 62]: the Dynamic Island's strip moves to the
// sides, and iOS keeps it on both so content stays centred. So on an iPhone
// laid out wider than tall whose window reports nothing on the sides, the top
// inset (the island's strip, right for each model) goes to both sides, and the
// bottom becomes the home indicator's landscape strip. An iPad is left alone:
// it has no island, and keeps a status bar at the top in every orientation.
export function insetsFor(
  reported: readonly number[] | null,
  view: { width: number; height: number; iPhone: boolean },
): number[] | null {
  if (!reported || reported.length !== 4) return reported ? [...reported] : null
  const [top, right, bottom, left] = reported
  const sideways = view.width > view.height
  if (view.iPhone && sideways && right === 0 && left === 0 && top > 0) return [0, top, Math.min(bottom, LANDSCAPE_BOTTOM), top]
  return [top, right, bottom, left]
}

// Writes the four values, zeros included (on iOS they replace env(), which can
// be wrong; index.css), or removes them all when there are none, so the
// styles fall back to env().
export function applySafeArea(root: HTMLElement, insets: readonly number[] | null): void {
  SIDES.forEach((side, i) => {
    const value = insets?.[i]
    if (insets && typeof value === 'number' && Number.isFinite(value) && value >= 0) root.style.setProperty(`--native-safe-${side}`, `${value}px`)
    else root.style.removeProperty(`--native-safe-${side}`)
  })
}

export function keepSafeArea(root: HTMLElement = document.documentElement): () => void {
  let stopped = false
  // Imported when used: backend.ts reads `window` as it loads, and this file's
  // pure part is tested without a page.
  const ask = () => {
    void import('@/lib/backend').then(({ nativeSafeArea }) => nativeSafeArea()).then(
      (insets) =>
        !stopped &&
        applySafeArea(root, insetsFor(insets, { width: window.innerWidth, height: window.innerHeight, iPhone: /iPhone/.test(navigator.userAgent) })),
      () => {},
    )
  }
  let later: ReturnType<typeof setTimeout> | undefined
  const onResize = () => {
    ask()
    clearTimeout(later)
    later = setTimeout(ask, 400)
  }
  ask()
  window.addEventListener('resize', onResize)
  return () => {
    stopped = true
    clearTimeout(later)
    window.removeEventListener('resize', onResize)
  }
}
