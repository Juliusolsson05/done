# Make every control on iPhone and iPad big enough for a finger

Issue: #109

## Outcome

On an iPhone or iPad every control outside Notes, Focus and the Board takes a
tap at least 44 points tall; the Time sheet fits a phone; a screen pushed from
Lists opens at its top; nothing runs into the notch in landscape. A Mac with a
mouse looks and measures exactly as it does today.

## Evidence

A Chromium touch-emulation audit of six phone and tablet viewports (findings
M01–M32, screenshots kept with the audit, not in the repository). The ones in
this change's files, with what was measured:

| id | where | measured |
|---|---|---|
| M01 | Time sheet, 390 phone | page 430 wide, remove button at x=402, title cell 67 px |
| M02 | phone back button | 63x28, tap area the same |
| M03 | list ⋯ in the phone bar | 32x32 |
| M04 | landscape fixed bars and sheets | task sheet edge to edge, into the 47 px notch strip |
| M05 | long-press menu | rows 216x28 |
| M06 | task sheet Cancel / Done | 52x22, 42x22 |
| M07 | push from a scrolled Lists | opens at scrollY 236, title 192 px above the screen |
| M09 | iPad 820 sidebar toggle, Board / Timeline | x=-8, tap area 20x28 |
| M10 | iPad checkboxes, header buttons, Time sheet arrows | 18x18, 28 px, 28x28 |
| M11 | iPad inline task editor | priority chips 33x28, all controls 28 tall |
| M13 | Settings in a phone or iPad browser | "Download for Mac", terminal commands |
| M17 | push animation | body 405 wide on a 390 phone during the animation |
| M19 | header chips (Filter, View, Today, Rename…) | 28 tall |
| M21 | sidebar titles on touch | "Show sidebar (⌘B)" |
| M22 | task sheet selects | 22 tall |
| M23 | quick add Cancel / Add | 36 tall |
| M26 | Lists "Add List", Search | 70x22, 36 tall |
| M27 | Settings Copy, Download, switch | 28 tall, switch hit 54x32 |
| M28 | "Show subtasks" count on a phone row | 53x28 |
| M29 | landscape phone: bars cover 39 %, long press on the tab bar opens the page menu | |
| M30 | phone Timeline titles cut to 139 px | |

Notes (M08, M12, M14–M16, M24, M25, M32), Focus (M18) and Board (M20) belong
to other branches.

## Decisions

- **Which rule makes a control larger.** Sizes that today apply to the phone
  layout only (`max-md:`) and should reach the iPad move to `touch:` (phone or
  tablet layout). The phone layout also covers a Mac window under 768 wide, so
  that window keeps what it has today. Sizes that are new in this change use
  `pointer-coarse:`, which a mouse never matches, so no Mac window, narrow or
  wide, changes. Default if wrong: a narrow Mac window would keep 28 px
  controls it already had.
- **Time sheet on a phone** is a list, not a table: the title on its own line
  (wrapping, not cut), then the times and "took 25 min of 30 · 5 min under",
  and a 44 px remove button on the right. The table stays for tablet and Mac.
  Removing stays a visible button rather than a swipe: nothing is lost and it
  needs no new gesture.
- **Pushed screens open at the top.** `openView` marks the change as a push;
  a layout effect scrolls the window to 0 when the page key changes after a
  push, on a phone only. Back keeps today's behaviour (no saved positions in
  this change).
- **iPad sidebar toggle.** On touch the toggle stops hanging in the page
  margin (the wide views' 32 px padding cannot hold it) and gets a 44 px row
  of its own above the page's header. The Mac keeps the margin button.
- **Long-press menu** rows get `pointer-coarse:min-h-11` and body text, in the
  shared context-menu primitive (the same pattern the notes Lists menu uses).
- **iPad task editor** keeps the inline editor; each control gets
  `pointer-coarse:h-11`. Follow-up (not here): opening the phone's sheet as a
  centred form sheet on the iPad is probably the better design, since it
  already has 44 pt rows and the long-press actions; it is a redesign, and the
  owner should see it on its own.
- **Settings in a browser** shows the Mac download and the terminal pane only
  on the desktop layout (a mouse and a wide window). The Mac app itself is
  unaffected.
- **Push animation overflow**: `overflow-x: clip` on the phone's body, so a
  page sliding in cannot widen the layout viewport.
- **Landscape**: the task sheet keeps its content inside the side safe areas;
  the tab bar and New Task no longer start the page's long-press menu.

## Not done here (deferred)

- M29's space taken by the bars in landscape (fold New Task into the nav bar):
  a layout decision for the owner, not a sizing fix.
- M30, wrapping Timeline titles: every title row lines up with a bar on the
  chart at a fixed height; the full title is one tap away in the task sheet.
- M22's "Delete Task under the home indicator": the sheet already pads its
  end by the safe area; the button is under it only because the sheet is
  longer than the screen and scrolls.

## Checks

- `ui/checks/touch-sizes.cjs`: Playwright (Chromium, touch) against the built
  UI with stubbed `/api`. At 390x844: no horizontal overflow on Time sheet and
  its rows fit the screen, back button and task-sheet Cancel/Done ≥ 44 tall, a
  screen pushed from a scrolled Lists opens at scrollY 0. At 820x1180: task
  checkboxes and header buttons have ≥ 44 px tap areas (measured with
  `elementFromPoint` at the edges) and the sidebar toggle is fully on screen.
  It must fail on `origin/main`.
- `npm run typecheck && npm test && npm run build`.
- A 1440x900 mouse pass comparing screenshots and sizes before and after.

## Verification

(filled in as the work lands)
