import * as React from "react"

// Which of done's three layouts this window gets:
// - phone: the iOS-style screens (tab bar, Lists, sheets); the window scrolls.
// - tablet: the window layout, made for a finger (an iPad).
// - desktop: the window layout with a mouse (the Mac, a browser).
export type Layout = "phone" | "tablet" | "desktop"

// Narrower than this is a phone, whatever the pointer. A Mac window made this
// narrow gets the phone layout too, as it always has.
const MOBILE_BREAKPOINT = 768
// A touch screen whose shorter side is under this is a phone. Every iPhone is
// under 450 points across and every iPad over 740, so an iPhone turned
// sideways (812 to 956 wide) stays a phone instead of becoming a Mac.
const PHONE_SHORT_SIDE = 500
// A tablet narrower than this (an iPad upright) is too narrow for the sidebar
// to stay beside the page, so it is put away until asked for, as in Mail.
const SIDEBAR_DOCKS = 1024

// The rule itself, apart from the browser so it can be tested. `coarse` is a
// finger rather than a mouse as the main pointer: `(pointer: coarse)`.
export function layoutFor(width: number, height: number, coarse: boolean): Layout {
  if (width < MOBILE_BREAKPOINT) return "phone"
  if (!coarse) return "desktop"
  return Math.min(width, height) < PHONE_SHORT_SIDE ? "phone" : "tablet"
}

// Known from the first paint, not after it: a phone must never be shown the
// window layout for one frame. Kept in one place for the whole page, and
// written to <html data-layout> so the stylesheet follows the same rule (the
// `phone:`, `wide:`, `touch:` and `desktop:` variants in index.css; `md:` and
// `max-md:` are redefined there to mean wide and phone).
// Not in a test without a page (or with a page that has no media queries).
const browser = typeof window !== "undefined" && typeof window.matchMedia === "function"
const coarseQuery = browser ? window.matchMedia("(pointer: coarse)") : null
let layout: Layout = "desktop"
let docked = true
let measuredWidth = -1
const listeners = new Set<() => void>()

function measure() {
  const width = window.innerWidth
  // The iOS keyboard coming up makes the window shorter, not narrower. Only
  // a change of width (turning the device, resizing a window or a split view)
  // may change the layout, or typing on an iPad held sideways would turn it
  // into a phone.
  if (width === measuredWidth) return
  measuredWidth = width
  const next = layoutFor(width, window.innerHeight, !!coarseQuery?.matches)
  const nextDocked = next !== "tablet" || width >= SIDEBAR_DOCKS
  document.documentElement.dataset.layout = next
  if (next === layout && nextDocked === docked) return
  layout = next
  docked = nextDocked
  listeners.forEach((listener) => listener())
}

if (browser) {
  measure()
  window.addEventListener("resize", measure)
  coarseQuery?.addEventListener("change", () => {
    // The pointer changed, not the width: measure again all the same.
    measuredWidth = -1
    measure()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLayout(): Layout {
  return React.useSyncExternalStore(subscribe, () => layout, () => layout)
}

// The phone layout: an iPhone either way up, or any window under 768 wide.
export function useIsMobile() {
  return useLayout() === "phone"
}

// A finger, not a mouse: a phone or an iPad. No hover, no shortcut hints.
export function useIsTouch() {
  return useLayout() !== "desktop"
}

// Whether the sidebar has room to stay beside the page. False only on a
// tablet held upright.
export function useSidebarDocked() {
  return React.useSyncExternalStore(subscribe, () => docked, () => docked)
}
