# iPhone and iPad get a layout of their own, clear of the notch

Branch `fix/mobile-layout-safe-areas` · Worktree `../done-wt/mobile-layout-safe-areas` · Base `origin/main` @ 946002b
Source: the mobile audit (`docs/mobile-audit/index.html` on `mobile-audit`), "Cross-cutting causes" 1 and 2.
Status: implemented, not pushed. Size: standard plan.

## Outcome

- An iPhone turned sideways keeps the phone layout (tab bar, New Task, sheets) instead of the Mac one.
- An iPad keeps the window layout, made for a finger: no keyboard hints (⌘K, Q, Tab), sidebar rows a finger can hit, hover-only buttons always shown, and in portrait the sidebar is put away until asked for.
- Nothing is drawn under the status bar, the Dynamic Island or the home indicator on any layout, on any side.
- The phone's back button goes back where you came from, not always to Lists.
- `lib/backend.ts` can tell the Mac app from the iPhone/iPad app, for Settings (another branch uses it).
- The Mac and a desktop browser look and behave exactly as before.

## Evidence

- `hooks/use-mobile.ts` switches on width alone (< 768). iPhone 17 landscape is 874 pt wide, iPad (A16) 820 and 1180.
- About 100 `md:` / `max-md:` classes across the UI, plus shadcn's sidebar (`hidden md:block`), encode "phone or window" by width, separately from `useIsMobile`. On an iPhone in landscape the two disagree today only because both say "desktop"; changing the hook alone would split them.
- Every `env(safe-area-inset-*)` in the UI sits behind `max-md:` or in a phone-only component; left and right are never used.

## Decisions

1. **Three layouts, one pure rule** (`layoutFor(width, height, coarse)` in `hooks/use-mobile.ts`):
   phone when width < 768, or a coarse pointer with the shorter side < 500; tablet for any other coarse pointer; desktop otherwise. A Mac (fine pointer) gets exactly today's split.
2. **The rule lives on `<html data-layout>`, set before the first paint and on every resize.** Tailwind custom variants read it: `phone:`, `wide:` (tablet or desktop), `touch:` (phone or tablet), `desktop:`.
3. **`md:` and `max-md:` are redefined to follow the layout** (`md` = wide, `max-md` = phone) rather than rewriting ~100 classes in files other branches are editing. Every existing use was read: each one means "window" or "phone", none means a width. `sm:`/`lg:` stay width-based (dialog widths, Focus digits). Verified with Tailwind 4.3.5's compiler: the override replaces the media query and keeps specificity (`:where`).
4. **Scrolling follows the layout, not the width**: phone scrolls the window, wide scrolls the inner panel (`md:h-svh`, `md:overflow-y-auto` now mean "wide"). Rotating an iPhone or an iPad no longer switches between the two, so scroll position survives.
5. **Safe areas**: the app shell pads left and right on every layout (iOS's own margins are the inset plus 16 pt, which the shell plus the page's `px-4` gives); the wide layout also pads top and bottom, and the sidebar carries the insets of the edges it touches. Fixed things (phone bars, New Task, find bar, toasts, dialogs, the filter sheet, the action sheet) carry their own, as `max(current, inset)` or the inset plus their current gap. On a Mac all insets are 0.
6. **iPad portrait (tablet, width < 1024)**: the sidebar starts put away, the existing "Show sidebar" button brings it back, and choosing a view puts it away again. Turning to landscape brings it back. It still pushes the page rather than floating over it (smallest change; overlay is a later choice).
7. **Back is a small stack of views** (at most 20) kept in the UI state: opening a pushed view remembers where you were, opening a tab starts over, back pops (skipping a list that was deleted) and falls back to Lists. Pure helpers in `lib/view-history.ts`.
8. **`isMacApp` and `isIosApp`** in `lib/backend.ts`, from the user agent (iPadOS reports itself as a Mac, so a Mac agent with touch points is an iPad). `isDesktop` unchanged.

UNCONFIRMED: all are defaults chosen without the owner; Julius owns design.

## Out of scope (other branches)

Timeline, Notes, task sheet, quick add, Settings content, menus and row touch actions. Left to them: the side insets of the task sheet (`task-editor.tsx`) and the phone quick add (`quick-add.tsx`), the hover-only buttons on task rows, and Settings switching to `isMacApp`.

Not done here: popovers' collision padding is not inset-aware (Radix takes numbers only; insets are 0 on an iPad's sides anyway). The "Show sidebar" button sits 8 points outside the page's edge on Timeline and Board, where the page margin is 32 points; that is so on the Mac today and is left as it is.

## Verification

`npx tsc -b` clean, `npx vitest run` 30 files / 555 tests pass. Unit tests for `layoutFor` (2 of 4 fail against the old width-only rule: iPhone sideways and iPad), the iOS agent check and the view history. A `vite build` to a scratch folder has no width media queries left for `md`/`max-md` and the class merges (sidebar width and offset, dialog overflow, Kbd) come out as intended. Simulators: not run here (no builds on this branch); to check on iPhone 17 and iPad (A16) in both orientations.
