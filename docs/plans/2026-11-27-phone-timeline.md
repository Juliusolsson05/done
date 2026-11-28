# Timeline: the days are the main thing on a phone

Branch `feat/phone-timeline` · Worktree `../done-wt/phone-timeline` · Base `origin/main` @ 6b8c47c (2026-11-27), rebased on f746b8e (2026-11-28) · Issue #111
Status: built; review findings fixed. Size: the touch Timeline only (`timeline.tsx`, `lib/timeline-window.ts`, new `lib/timeline-touch.ts`).

## Outcome

On an iPhone the Timeline is a chart of days with the tasks on it, not a list of names with a strip of days beside it. The days take the whole width, a day is wide enough to read and to hit with a finger, every task's name is readable, Today is one tap, and a zoom (Day, Week, Month, Quarter) is remembered. The iPad gets the same. The Mac Timeline (`timeline-desktop.tsx`) does not change.

## Evidence

Owner, 27 Nov: "the timeline is still impossible to read on phone because the task menu takes up like 60% and the timeline is SO SMALL and the days are so little width that I can barely see what is going on in the timeline."

Measured on `origin/main` (6b8c47c) in Chrome with touch emulation, 15 dated tasks over three weeks in three projects plus three undated (`ui/checks/touch-timeline.cjs` seeds the same shape):

| Viewport | Layout | Name column | Days get | px a day | Days on screen | Name shown | Weekday / date text |
|---|---|---|---|---|---|---|---|
| 390×844 | phone | 186 px (48 %) | 172 px (44 %) | 40 | 4.3 | 139 px | 10 / 11 px |
| 440×956 | phone | 212 px (48 %) | 196 px (45 %) | 40 | 4.9 | 165 px | 10 / 11 px |
| 844×390 | phone | 260 px (31 %) | 552 px (65 %) | 40 | 13.8 | 197 px | 10 / 11 px |
| 820×1180 | tablet | 260 px (32 %) | 496 px (61 %) | 40 | 12.4 | 201 px | 10 / 11 px |
| 1180×820 | tablet | 260 px (22 %) | 600 px (51 %) | 40 | 15.0 | 201 px | 10 / 11 px |

Also found: on the phone layouts the page itself is 91–228 px wider than the screen while the Timeline is open (`scrollWidth` > `clientWidth`), which pushes the fixed tab bar out of the emulated viewport.

The column of names was the 24 Nov rebuild's choice (`2026-11-24-timeline-rebuild.md`, decision 1, then raised to 52 % for phones): it reads well on an iPad but on a phone it leaves the chart a sliver, and every week zoom is 40 px a day whatever the room.

## Decisions

1. **No column of names on touch. Each task's name goes on a line directly above its bar, pinned to the visible edge.** A row is 64 px: the name line (check, project dot, name, who is on it) on top, the bar below. The name starts where the bar starts and is `position: sticky` (left and right 8 px) inside its row, so when the bar runs off either side the name stays on screen at that edge, and the row always says what it is. — why: a fixed or collapsing gutter still spends width on every row at all times (the owner's complaint) or hides the names exactly when scrolling; above-the-bar gives the days 100 % of the chart and gives the name the whole row (one task per row, so it never runs into another). The desktop design puts titles in or beside blocks for the same reason. Sticky is CSS, so it follows the finger without script. — cost if wrong: rows are 24 px taller than the 40 px rows (more vertical scrolling); 15 tasks are 960 px, which the chart scrolls.
2. **Pixels per day are fitted to the room, per zoom** (`lib/timeline-touch.ts`, `dayWidth`): Day fits 5 days (64–112 px), Week fits 7 (44–72 px), Month fits 31 (12–28 px), Quarter fits 91 (4–10 px). Week is the default. At 390 pt that is 51 px a day in Week and 71 px in Day. — why: a fixed 40 px is too narrow on a phone and wastes the iPad's room; the bounds keep a day hittable (44) and stop Week becoming one fat week on an iPad. — cost if wrong: four numbers in one table.
3. **The zoom is four segments always on screen** (Day, Week, Month, Quarter), 44 px high, and remembered on the device under its own key (`done-timeline-touch-zoom`, read once from the old shared key so a Month or Quarter choice carries over). — why: the Mac Timeline reads `done-timeline-zoom` and does not know Day. Pinch was rejected: it fights the browser's own pinch and the scroll, and a toggle is what the owner asked for.
4. **The header**: 72 px (`h-18`), months on top (sticky at the left edge, 13 px), then each day's weekday letter (11 px) and date (13 px, today in a blue circle) when a day is at least 32 px; at Month and Quarter, Mondays only (with the weekday while a week is at least 56 px, the date alone below that). Nothing in the chart is under 11 px. At Quarter on a 320 pt phone a day is 4 px, so Mondays are 28 px apart: the dates (13 px, in a 24 px box) just clear each other.
5. **Controls**: on a phone two rows under the title: the zoom segments across the width; then By project, Filter and Today (in done's blue, the obvious way back). On an iPad one row beside the title, plus the No date column toggle where it has room. All 44 px high. The View menu goes: its two choices are now on screen.
6. **Bars**: 24 px drawn; the bar takes presses from under the name line to the row's end, and pressing the name is pressing the task (tap opens, hold moves), so the task is a 64 px target; off-screen chips 24 px with a 44 px hit area. Touch keeps the 24 Nov rules (`lib/timeline-press.ts`): hold 380 ms to lift, a move first is a scroll, a tap opens, grips stretch the ends. Added by review (below): the long-press menu rule, the slop on days dragged, and no drag of a bar that is off screen.
7. **Scrolling**: one scroller for both directions as before (the date header is sticky inside it); the visible-range state is updated once per frame instead of on every scroll event. Opens with today on screen (`initialLeft`, unchanged). The day in the middle of the chart is kept across zooms, rotation and new tasks; only a scroll by the person (or Today) moves it.
8. **No date** stays a section under the chart on phones, now pinned to the visible width instead of the name column; the iPad keeps the side column from 880 px.

## Tests

- `lib/timeline-touch.test.ts`: `dayWidth` at each zoom at 358, 408, 812 and 860 px of chart (the 390, 440, 844 and 1180 viewports): Week at least 44, Day at least 64, Week fits a whole week on a phone; `parseZoom` for new, old and junk values; `ticks` (which header labels show) by width.
- `lib/timeline-window.test.ts`: `paneLayout` no longer returns a column width.
- `lib/timeline-press.test.ts`: `daysDragged` counts no days within the slop at 4 and 12 px a day, one day first at Quarter, whole days past it, and never pulls an end past the other.
- `lib/swallow-click.test.ts`: the one click after a release is eaten, and no more; it is not waited for past 400 ms.
- `ui/checks/touch-timeline.cjs` (Playwright, Chromium with touch at 390×844, the built UI with a mocked API, like `touch-note-toolbar.cjs`; 25 expectations, each reported, each scenario on a fresh page): the chart is at least 75 % of the viewport width; a day is at least 44 px; today's date is visible on open; the top corner of a bar is the bar (not the check above it); a plain swipe scrolls and sends no change; a hold-and-drag moves a bar exactly one day and nothing else; held a second, no menu while lifted, then dragged one day; held and let go in place, and let go 3, 4 and 6 px away, the task's menu stays open and nothing else happens; held on the check, no menu while held, then the menu and the task not completed; a tap opens the task's sheet; a hold on an end's grip stretches it a day; a 3 px tremble at Quarter moves nothing; Quarter and back to Week keeps today on screen; a hold on the name of an off-screen bar moves nothing; the zoom is one tab stop and arrows change it; a bar is not a tab stop; Day zoom is remembered across a reload.

## Rulings made while building

- **Rows are 64 px, not 56, and the check's presses stop where the bar is drawn** — why: at 56 the check's 44 px hit area reached 11 px into the bar under it, so a press on the top of a bar could complete the task. At 64 the check takes 46×36 px of presses (from 2 px above the row to the bar's top edge) and the bar's presses stop where the name line starts. On a phone that needs the override in TaskCheck's own `max-md:` variant: its `max-md:after:-inset-3` is a different variant from a plain `after:` override, tailwind-merge keeps both and the phone rule won, so until review the area was still 44 px tall and reached into the bar (measured by the review; the check now asserts the bar's top corner is the bar). — cost if wrong: 8 px a row; the check is 36 px tall, not 44, traded for never completing a task by a press meant for its bar.
- **The bar is `role="button"`, `tabIndex={-1}`, labelled with its dates** — why: in Chromium a finger on a bar was steered to the check above it (touch adjustment prefers controls), so a hold on the bar did nothing. Not a tab stop: the name above it is one, and opens the same task. — cost if wrong: none seen.
- **A tap opens the task on the click that follows, not on pointerup** — why: measured on `origin/main` too: the task's sheet came up under the finger on pointerup and the click that followed landed on its backdrop and shut it, so a tap on a bar showed nothing (Chromium touch emulation; not checked in WebKit). — cost if wrong: if a browser sent no click after a tap, a tap would open nothing; React puts a click handler on the element, which is what iOS needs to send one.
- **A focus day: the day in the middle, which only a scroll by the person or Today changes** — why: keeping the left edge left today off screen after Quarter and back; and keeping the middle by reading the scroll position on each zoom lost it too (review), because Quarter on a phone cannot scroll and so overwrote it. The view's own scrolls (to keep the focus day) are told apart from a person's by the position it last set.
- **The long-press menu: drag on move, menu on release in place (the Board's rule, PR #116)** — why: Radix starts its own 700 ms long press on the window's menu on any touch pointerdown, so a bar held a second opened the task's menu, and held then dragged it opened the menu and moved the task (on `origin/main` too). A finger's press on a bar or its name now stops there (`stopPropagation`, so Radix starts nothing); a held bar moved past the 8 px slop is a drag and never opens the menu; one let go without moving (within the slop) opens the task's menu at the finger (the Timeline sends the `contextmenu`), and the click the release sends is eaten (`lib/swallow-click.ts`, moved there from the Board, which uses it too): without that, let go 3 to 6 px away, the click landed on the menu just opened and chose an item (second review saw Add subtask). The check holds to the same rule: no window long press while held, a hold let go in place opens the menu and completes nothing. A plain swipe still scrolls and a tap still opens the task. — cost if wrong: on iOS, where the web view sends no `contextmenu` of its own, the menu now comes on release, not at 700 ms.
- **Days dragged are counted from past the slop** (`daysDragged`, 8 px: sign(dx) × round((|dx| − 8) / px)) — why: at Quarter (4 px a day) a 2 px tremble on letting go moved the task a day, at Month 6 px did; counting whole days from the start once past the slop made the first step at Quarter two days. — cost if wrong: a drag lands up to 8 px short of the finger, under a fifth of a day at Week.
- **A hold on the name of a bar that is wholly off screen drags nothing** — why: the name is pinned at the edge, and the bar it would move cannot be seen. A tap still opens the task, and a hold let go in place its menu. The chip beside it scrolls the bar into view.
- **The zoom is one tab stop** (the chosen segment); arrow keys choose another.
- **A tap's pending open is cleared on the next press**, so a tap whose click never came cannot open a task on a later press.
- **The help line is hidden on a phone held sideways** (under 500 px tall), as it already was on the iPad — the chart needs the height.
- **The zoom segments run across the width only on a phone held upright**; held sideways they sit beside By project, Filter and Today in one row.

## Verification

Chromium (installed Chrome) with touch emulation, the built UI with a mocked API (the seed in `ui/checks/touch-timeline.cjs`), Week zoom:

| Viewport | Name column | Days get | px a day | Days on screen | Longest name shown | Weekday / date / smallest text | Today on open |
|---|---|---|---|---|---|---|---|
| 390×844 | 186 → 0 px | 44 % → 92 % (358 px) | 40 → 51 | 4.3 → 7.0 | 139 → 277 px (in full) | 10/11/10 → 11/13/11 px | yes → yes |
| 440×956 | 212 → 0 px | 45 % → 93 % (408 px) | 40 → 58 | 4.9 → 7.0 | 165 → 277 px | 10/11/10 → 11/13/11 px | yes → yes |
| 844×390 | 260 → 0 px | 65 % → 96 % (812 px) | 40 → 72 | 13.8 → 11.3 | 197 → 277 px | 10/11/10 → 11/13/11 px | yes → yes |
| 820×1180 | 260 → 0 px | 61 % → 92 % (756 px) | 40 → 72 | 12.4 → 10.5 | 201 → 277 px | 10/11/10 → 11/13/11 px | yes → yes |
| 1180×820 | 260 → 0 px | 51 % → 73 % (860 px, beside the sidebar) | 40 → 72 | 15.0 → 11.9 | 201 → 277 px | 10/11/10 → 11/13/11 px | yes → yes |

(The percentages are of the whole viewport; at 1180×820 the docked sidebar takes the rest.) Day zoom at 390: 71 px a day, 5 days. Month: 12 px, Quarter: 4 px (Mondays labelled).

- `ui/checks/touch-timeline.cjs`: 25 of 25 pass on this branch; at the second PR head (b3d2160, rebased) 2 fail (let go 6 px away chose a menu item; the check's long press opened the menu); of the 20 before that, 10 of 20 fail at the first PR head ec809aa (check over the bar, long-press menu ×3, Quarter tremble, Quarter and back, off-screen bar, zoom tab stops, arrow keys, bar tab stop); 12 fail on `origin/main` (width, day width, long-press menu ×3, tap, and the zoom and name scenarios that main has no controls for). Stretching an end and the remembered zoom already worked at ec809aa; the cleared tap has no outside sign to check.
- By hand in the same browser: By project folds; No date opens under the chart; a tap on a name opens the task's sheet.
- Desktop at 1440×900: a screenshot of the Timeline from `origin/main`'s build and from this branch's is pixel-identical (two shots of the same build can differ while the page settles, so both were taken with reduced motion after 2.5 s). `timeline-desktop.tsx`, `timeline-layout.ts` and `App.tsx` are unchanged.
- `npm run typecheck`, `npm test` (740 tests; `note-list.test.ts` failed once in five runs here, a test this branch does not touch), `npm run build`. `ui/checks/board-heights.cjs` passes after `swallowClick` moved.
- The phone height uses main's `--phone-nav`, `--tab-bar` and `--phone-page-end`, as the Board does.

Also seen, not changed (not this branch's files): in Chromium's phone emulation, once a pushed page (Timeline, Notes) is open the document is 91–228 px wider than the screen, so the fixed tab bar is laid out wider than the screen. It happens on Notes as well, so it is the page push in the app shell, not the Timeline.

## Not verified

WebKit and a real iPhone (no WebKit runner or device for this agent; Chromium touch emulation only). The iOS `touchmove` hold path is unchanged code.
