# iPhone app: landscape safe areas, a focus timer in the Dynamic Island, home screen widgets

Fixes #70 (the Dynamic Island covers content when the iPhone app is held sideways) and #71 (home
screen widget and a focus timer in the Dynamic Island). Research, sources and the screenshots
that led here: `docs/mobile-audit/index.html#open-plan`.

## 1. Side safe areas (#70)

**Problem.** In the Tauri web view on iOS, `env(safe-area-inset-left/right)` is 0 when the
iPhone is held sideways, so every view starts under the Dynamic Island. Safari on the same
simulator reports 62 pt each side; `contentInsetAdjustmentBehavior = .never` did not change it
(tried in #65). Tauri issue 11475 reports the same family of problems and is still open.

**Fix.** Stop depending on WebKit for the insets. A Tauri command, iOS only, reads the safe area
of the window the web view is in (`UIView.window.safeAreaInsets`, on the main thread) and
returns it. The interface asks on start and whenever the window resizes or turns, and sets
`--safe-top/right/bottom/left` on `<html>`. Every inset in the styles becomes
`max(env(safe-area-inset-X), var(--safe-X, 0px))`, so the web, the Mac and iOS portrait (where
`env()` already works) are unchanged, and iOS landscape gets the real value.

Decision: `max()` of both rather than the variable alone, so a WebKit that does report the inset
keeps working the instant the page loads, before the command answers.

## 2. Focus timer in the Dynamic Island (#71)

**How data reaches native code.** The app's Rust is a static library linked into the Xcode app
target. Swift files in that target export C functions (`@_cdecl`), which Rust declares as
`extern "C"` and calls; the symbols resolve at the app's link. No Tauri plugin crate, no
swift-rs: two languages in one binary, one boundary of plain C strings (JSON).

**Focus.** The window already hands its focus session to Rust (`focus_set`) whenever it changes,
for the Mac's menu bar. On iOS, Rust passes the same session, plus the task's title (added to
the payload), to Swift, which starts, updates or ends one Live Activity
(`Activity<FocusAttributes>`). The countdown uses `Text(timerInterval:)` so it ticks with the
app suspended. Paused shows the time left, still.

**Views.** Compact: a timer glyph and the time left. Minimal: the time left. Expanded: the task
title, the time left large, and the end time. Lock Screen: the same as expanded.

## 3. Home screen widgets (#71)

The interface, which already computes Today, sends a small snapshot (the next few of today's
open tasks with overdue marks, the count left today, the running focus) to Rust whenever it
changes (debounced); Rust passes it to Swift, which writes it as JSON into the App Group
container and asks WidgetKit to reload. The widget extension reads that file.

Widgets: small (count left today + the next task), medium (next four tasks), large (next eight),
and Lock Screen accessory (count, or the focus time left). Tapping opens done. No interactive
check buttons in this PR (they need App Intents running the app's own logic; follow-up).

## 4. Keeping it through regeneration

`gen/apple/project.yml` is the source of the Xcode project (XcodeGen). The widget extension
target, the App Group entitlement on both targets, `NSSupportsLiveActivities`, and the shared
`FocusAttributes` source (compiled into both targets) are declared there, and the project is
regenerated with `xcodegen generate` (2.45: an app-extension target with `info:` needs a `path:`).

App Group: `group.app.thedone`. Extension bundle id: `dev.done.app.widgets`. Extension
deployment target iOS 16.1 (Live Activities); the app stays at 15.0 with availability checks.

## Verification

- iPhone 17 simulator held sideways: content clear of the Dynamic Island (before/after
  screenshots).
- Start a focus in the app (simulator): the countdown appears in the Dynamic Island and on the
  Lock Screen, and ends with the focus.
- Widget data file written to the App Group container after a change (read it back from the
  simulator's container); the extension builds and embeds; a widget added on the simulator's
  home screen shows today's tasks if the home screen can be driven, otherwise stated as not seen.
- `tsc -b`, `vitest run`, `cargo check` for iOS.

## Not in this PR

Interactive widget buttons (App Intents), push updates for the Live Activity from the server,
Android equivalents, App Store distribution profiles.

## What building it found (24 Nov)

- **The window itself reports portrait insets in landscape.** A readout in the app showed
  `[62, 0, 34, 0]` from `window.safeAreaInsets` at 874×402 pt, and `env()` the same, while Safari
  gets `[0, 62, 20, 62]`. So asking UIKit alone does not fix #70. The page turns the portrait
  values for an iPhone laid out wider than tall (`insetsFor` in `ui/src/lib/safe-area.ts`), and
  on iOS the native values win over `env()` (zeros included), which also removes the empty band
  that `env()`'s top inset left at the top in landscape. Changed from the plan's `max()`.
- **`done://` lived only in Info.plist.** Regenerating from `project.yml` dropped the URL scheme
  that `tauri ios init` had written into Info.plist once, which would have stopped sign-in from
  returning to the app. It is declared in `project.yml` now.
- **The iOS cdylib.** The crate is also built as a cdylib (Tauri's template), linked without
  the Swift code; `build.rs` leaves the two Swift symbols undefined there (`-Wl,-U`).
- **Entitlements rewritten during the build.** Tauri's "Build Rust Code" step writes the
  entitlements file (same content); `CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION` lets the build
  go on.
- **First Live Activity asks.** iOS shows "Allow Live Activities from done?" on the Lock Screen
  the first time; until allowed, the Lock Screen card shows the time redacted.

Seen on the iPhone 17 simulator: content clear of the Dynamic Island held sideways; the
countdown in the Dynamic Island with the app in the background and on the Lock Screen; the
Today widget in the gallery and on the Home Screen with the real snapshot (1 overdue task and
the running focus). Not seen: the expanded Dynamic Island (a simulated long press did not open
it), the activity ending when focus ends, a real device.
