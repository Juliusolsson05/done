# Timeline: rebuilt to work at every size

Branch `fix/mobile-timeline-rebuild` · Worktree `../done-wt/mobile-timeline-rebuild` · Base `origin/main` @ 946002b (2026-11-23)
Status: building. Size: one view, rebuilt.

## Outcome

The Timeline reads and works on iPhone portrait (402×874), iPhone landscape (874×402), iPad (820×1180, 1180×820) and the Mac: titles in a fixed left column, bars in a grid to their right, opened on today, no page-level sideways scroll, controls that fit, and touch that scrolls unless you hold a bar.

## Evidence (from the mobile audit, `done-wt/mobile-audit/docs/mobile-audit/index.html#timeline`, and the code)

- Titles are drawn beside short bars (`TimelineItem`, `inside` false) and run under the next row's bar; the check circle sits in a pale block with the faces on top, so on a phone they overlap.
- Only grouped by project is there a title column (`side`); otherwise bars start at x 0 and the earliest bar opens cut off at the left.
- The page scrolls sideways because `ViewHeader` does not wrap above `md`: zoom + Group by project + Today + Filter + No date overflow the content at 874 and 820 pt.
- On a phone nothing bounds the view's height (`md:h-svh` only), so the chart grows with its rows, the window scrolls and the sticky date header slides away. The No date panel and its toggle are `max-md:hidden`.
- Bars are `touch-none` and a drag starts on pointerdown: a pan on a bar moves the task. Resize grips are 6–8 px.

## Decisions (defaults; the owner sees a preview)

1. **Layout**: one scroll container. A sticky left column (one row per task: check, title, faces; foldable project headers) and the bars to its right, row for row; the date header sticky at the top. One scroll container keeps one vertical scroll for both panes without syncing two scrollers by script, and the sticky date header keeps working (sticky only sticks to its nearest scroller). Bars carry no text.
2. **Sizes** are decided by the width the Timeline actually has (ResizeObserver), not the window: a Mac window with the sidebar open and an iPad in portrait both get the compact header. Left column: 38 % of the width, at least 140 px, at most 260 px, below 700 px; 260 px from there. Compact controls below 880 px. The No date side column (240 px) only from 880 px; below that No date is a collapsible section at the bottom of the left column, whose rows open the task.
3. **Height**: on a phone the view fills from its top to the tab bar (`3.0625rem + env(safe-area-inset-bottom)`), and gives back the page's bottom padding beyond the tab bar, so the window does not scroll; the chart scrolls inside with `overscroll-contain`. Above `md` the existing `h-svh` flex chain already bounds it; the chart keeps a 14 rem minimum so iPhone landscape shows more than two rows (the page scrolls vertically instead).
4. **Opening position**: today with four days of room on the left; moved further left to the earliest bar when that still keeps today on screen with two days of room on the right.
5. **Touch**: on a touch or pen pointer a bar moves only after a 380 ms hold (it lifts, with the selection haptic); moving more than 8 px before that is a scroll and is left to the browser (`touch-action: pan-x pan-y`). A tap opens the task. A hold released without moving opens nothing. The mouse drags at once, as before. Grips get a 26 px hit area mostly outside the bar (each row has only one task, so the space beside a bar is free); the drawn grip stays thin.
6. **Controls**: compact = a "View" popover (zoom and grouping as radio groups), Filter, Today, and No date count; wide = the existing buttons. Uses the existing `Popover` (no new shadcn component).
7. **Help text** says "hold and drag" and "tap" on touch screens (`(pointer: coarse)`), and is hidden on screens under 500 px tall. On a phone Add task is the floating New task button, so the row is not drawn there.

## Change

- `ui/src/lib/timeline-window.ts`: `initialLeft` (opening scroll in days), `paneLayout(width)`.
- `ui/src/lib/timeline-press.ts` (new): the press state machine (`press`) and what a release does (`released`).
- `ui/src/components/timeline.tsx`: rebuilt rows, header, No date, touch handling.

## Tests

`timeline-window.test.ts`: opening position (today with room; reaches back to an earlier bar only when today still fits; clamped at both ends), pane layout at the five sizes. `timeline-press.test.ts`: mouse drags at once; touch waits for the hold; moving first is a scroll; tap opens; cancel resets.

## Verification

`npx tsc -b`, `npx vitest run` in `ui/`. No browser available to this agent: the owner checks the five sizes in the preview.

## Out of scope

App shell, safe areas and the phone/tablet breakpoints (other branches), the task sheet, a list-by-week phone alternative to the chart, and moving a task by a menu (the task sheet sets dates).
