// The safe area on the iPhone and iPad app, read from the window natively and
// handed to the styles as --native-safe-* on <html> (index.css combines them
// with env() into --safe-*, which every inset uses).
//
// WHY: in the Tauri web view on iOS, WebKit reports the side safe areas as 0
// when the phone is held sideways, so env(safe-area-inset-left/right) left the
// start of every view under the Dynamic Island (#70; Safari on the same
// simulator reports 62 pt each side, and turning off the scroll view's inset
// adjustment did not change it). The window itself knows the right values, so
// the app asks it (the `safe_area` command in crates/app) instead of waiting
// for WebKit.
//
// When to ask: at start, and after every resize, because turning the phone
// resizes the window. The answer is asked again a moment later as well:
// UIKit updates the window's insets during the rotation animation, which can
// finish after the resize event has fired.
const SIDES = ['top', 'right', 'bottom', 'left'] as const

// Writes the four values, or removes them when there are none, so the styles
// fall back to env() alone.
export function applySafeArea(root: HTMLElement, insets: readonly number[] | null): void {
  SIDES.forEach((side, i) => {
    const value = insets?.[i]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) root.style.setProperty(`--native-safe-${side}`, `${value}px`)
    else root.style.removeProperty(`--native-safe-${side}`)
  })
}

export function keepSafeArea(root: HTMLElement = document.documentElement): () => void {
  let stopped = false
  // Imported when used: backend.ts reads `window` as it loads, and this file's
  // pure part is tested without a page.
  const ask = () => {
    void import('@/lib/backend').then(({ nativeSafeArea }) => nativeSafeArea()).then(
      (insets) => !stopped && applySafeArea(root, insets),
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
