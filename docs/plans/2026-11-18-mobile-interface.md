# The interface on a phone

Fixes #15.
Branch `feat/mobile-ui` · Worktree `../done-wt/mobile` · Base `origin/main` @ a6cae4d (2026-11-18)
Status: plan only. Size: standard plan.

## Outcome

On a phone-sized screen Done is used with a thumb: the views are reached from a bar at the bottom, the full list of views and projects slides in from the side, a task is added from a box at the top of the screen where the keyboard cannot cover it, and nothing scrolls sideways or is too small to hit. On a Mac window nothing changes.

## Evidence (verified 18 Nov 2026, do not re-derive)

- At 390 px wide the sidebar is stacked above the content: the first screen is the whole list of views and projects, and the tasks start below it.
- The layout has one breakpoint in use, `md` (768 px). `ui/src/hooks/use-mobile.ts` reports the same breakpoint, and the generated sidebar component already knows how to be a slide-in sheet below it; the app switches that off with `collapsible="none"`.
- Quick add is drawn in place of the "Add task" row, wherever in the list that row is. On a phone that is usually under the keyboard.
- The round check on a row is 18 px and a row is 36 px tall. Apple's guidance for a touch target is 44 pt.
- iOS zooms the page when a field with text smaller than 16 px is focused. The fields here are already 16 px below `md`.
- The interface is one inlined HTML file served at `/`; there is nowhere to serve a web app manifest from.

## Decisions

1. **One breakpoint, the existing one.** Below 768 px is the phone layout. No tablet layout.
2. **A bar at the bottom** with Inbox, Today, Upcoming, Add and Menu. Alternative: a top bar with a menu button (every change of view is then two taps at the far end of the screen).
3. **The sidebar becomes the slide-in sheet** the component already has, opened by Menu, closed by choosing a view.
4. **Quick add opens at the top of the screen** on a phone, over a dimmed page. Alternative: fixed above the keyboard, which on iOS needs the visual viewport followed by script and still jumps.
5. **Rows are taller and their check has a 44 px hit area**; what was on the right of a row (subtask count, date) goes under the title, where a long title cannot squeeze it.
6. **The right-click menu stays, on a long press.** The system's own text callout is switched off on rows so the two do not fight.
7. **Styling only where possible**: `max-md:` classes on the existing components, no second set of components. New code: the bar, and the place quick add is drawn.
8. **Add to Home Screen** works through `<meta>` tags (full screen, title, status bar). No manifest and no service worker: there is nowhere to serve them from, and offline use is out of scope.

UNCONFIRMED: all eight are defaults; the owner asked for "super optimized on mobile" while away and gave no further direction.

## Files

- New: `ui/src/components/mobile-bar.tsx`.
- Changed: `ui/index.html`, `ui/src/index.css`, `ui/src/App.tsx`, `ui/src/hooks/use-mobile.ts`, `components/app-sidebar.tsx`, `quick-add.tsx`, `task-row.tsx`, `subtasks.tsx`, `list-view.tsx`, and whichever of board, timeline, focus, time sheet, settings turn out to need it when looked at on a phone.

## Tests

The change is layout. There is no logic to test apart from which views the bar marks as current, which is one expression. Verification is by eye, below.

## Verification

- `npm run typecheck && npm test && npm run build`.
- Every view opened at 390 x 844 in a browser emulating a phone, on a copy of the owner's tasks: Inbox, Today, Upcoming, a project, Timeline, Board, Focus, Time sheet, Settings; add a task, edit one, tick one, open subtasks, open the menu. No sideways scrolling in any of them (`document.documentElement.scrollWidth <= innerWidth`).
- The same views at 1280 px: unchanged.
- **Verification boundary:** not seen on a real iPhone here. The notch and home-indicator insets, the keyboard and the long press are checked on the simulator when the iPhone app is built.

## Out of scope

A tablet layout, swipe gestures on rows, offline use, dark mode.
