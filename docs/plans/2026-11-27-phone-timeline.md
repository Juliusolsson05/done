# Timeline: the days are the main thing on a phone

Branch `feat/phone-timeline` · Worktree `../done-wt/phone-timeline` · Base `origin/main` @ 6b8c47c (2026-11-27) · Issue #111
Status: built, in review. Size: the touch Timeline only (`timeline.tsx`, `lib/timeline-window.ts`, new `lib/timeline-touch.ts`).

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
4. **The header**: 64 px, months on top (sticky at the left edge, 13 px), then each day's weekday letter (11 px) and date (13 px, today in a blue circle) when a day is at least 32 px; at Month and Quarter, Mondays only. Nothing in the chart is under 11 px.
5. **Controls**: on a phone two rows under the title: the zoom segments across the width; then By project, Filter and Today (in done's blue, the obvious way back). On an iPad one row beside the title, plus the No date column toggle where it has room. All 44 px high. The View menu goes: its two choices are now on screen.
6. **Bars**: 24 px drawn; the bar takes presses from under the name line to the row's end, and pressing the name is pressing the task (tap opens, hold moves), so the task is a 64 px target; off-screen chips 24 px with a 44 px hit area. Touch behaviour is unchanged (`lib/timeline-press.ts`): hold 380 ms to lift, a move first is a scroll, a tap opens, grips stretch the ends.
7. **Scrolling**: one scroller for both directions as before (the date header is sticky inside it); the visible-range state is updated once per frame instead of on every scroll event. Opens with today on screen (`initialLeft`, unchanged).
8. **No date** stays a section under the chart on phones, now pinned to the visible width instead of the name column; the iPad keeps the side column from 880 px.

## Tests

- `lib/timeline-touch.test.ts`: `dayWidth` at each zoom at 358, 408, 812 and 860 px of chart (the 390, 440, 844 and 1180 viewports): Week at least 44, Day at least 64, Week fits a whole week on a phone; `parseZoom` for new, old and junk values; `ticks` (which header labels show) by width.
- `lib/timeline-window.test.ts`: `paneLayout` no longer returns a column width.
- `ui/checks/touch-timeline.cjs` (Playwright, Chromium with touch at 390×844, the built UI with a mocked API, like `touch-note-toolbar.cjs`): the chart is at least 75 % of the viewport width; a day is at least 44 px; today's date is visible on open; a hold-and-drag moves a bar by one day (one `/api/sync` with the new due date); a plain swipe scrolls the chart and sends no change. Fails on `origin/main` (172 px of 390 is 44 %, 40 px a day).

## Rulings made while building

- **Rows are 64 px, not 56** — why: at 56 the check's 44 px hit area reached 11 px into the bar under it, so a press on the top of a bar could complete the task. At 64 the check takes 46×36 px of presses and stops where the bar is drawn; the bar's presses stop where the name line starts. — cost if wrong: 8 px a row; the check is under 44 px tall (it is 44 wide), traded for never completing a task by a press meant for its bar.
- **The bar is `role="button"` with `tabIndex`** — why: in Chromium a finger on a bar was steered to the check above it (touch adjustment prefers controls), so a hold on the bar did nothing; as a control it also opens with Enter. — cost if wrong: none seen.
- **A tap opens the task on the click that follows, not on pointerup** — why: measured on `origin/main` too: the task's sheet came up under the finger on pointerup and the click that followed landed on its backdrop and shut it, so a tap on a bar showed nothing (Chromium touch emulation; not checked in WebKit). — cost if wrong: if a browser sent no click after a tap, a tap would open nothing; React puts a click handler on the element, which is what iOS needs to send one.
- **Changing zoom keeps the day in the middle in the middle** (it kept the left edge) — why: going from Quarter to Week from today left today off screen.
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

- `ui/checks/touch-timeline.cjs` passes on this branch (five runs in a row) and fails on `origin/main` at its first assertion ("the days get 172 of 390 px, under 75 %").
- By hand in the same browser: Day zoom is remembered across a reload; a hold on a bar's end stretches it by a day (Record the demo video, due 29 → 30 Nov, one `/api/sync`); By project folds; No date opens under the chart; a tap on a name or a bar opens the task's sheet.
- Desktop at 1440×900: a screenshot of the Timeline from `origin/main`'s build and from this branch's is pixel-identical (two shots of the same build can differ while the page settles, so both were taken with reduced motion after 2.5 s). `timeline-desktop.tsx`, `timeline-layout.ts` and `App.tsx` are unchanged.
- `npm run typecheck`, `npm test` (674 tests), `npm run build`.

Also seen, not changed (not this branch's files): in Chromium's phone emulation, once a pushed page (Timeline, Notes) is open the document is 91–228 px wider than the screen, so the fixed tab bar is laid out wider than the screen. It happens on Notes as well, so it is the page push in the app shell, not the Timeline.

## Not verified

WebKit and a real iPhone (no WebKit runner or device for this agent; Chromium touch emulation only). The iOS `touchmove` hold path is unchanged code.
