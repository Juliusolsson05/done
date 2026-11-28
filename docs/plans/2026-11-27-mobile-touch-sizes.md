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

## Apple's guidance, as applied

Read from Apple's Human Interface Guidelines on 27 Nov 2026 (the page data
behind developer.apple.com/design/human-interface-guidelines/layout and
/accessibility):

- Accessibility, control size: "iOS, iPadOS — default control size 44x44 pt,
  minimum 28x28 pt", and "Consider spacing between controls as important as
  size … about 12 points of padding around elements that include a bezel …
  about 24 points … without a bezel." Applied: every control in scope takes a
  44 pt tap on touch; adjacent header buttons get 8 pt gaps (`gap-2`) on
  touch, and borderless buttons keep their padding as part of their target.
- Layout, guides and safe areas: "respecting system-defined safe areas,
  margins, and guides", "A safe area defines the area within a window that
  isn't covered … by a hardware feature or another view … like a toolbar, tab
  bar, or status bar", and layout guides "apply standard margins around
  content and restrict the width of text for optimal readability." Applied:
  bars keep their background edge to edge and their content inside
  `--safe-*` (the existing variables in index.css / lib/safe-area.ts); the
  task sheet now does too; content columns stay capped (`max-w-3xl` /
  `max-w-4xl`, already in place) on iPad.
- The HIG pages do not state a margin number. The 16 pt (compact width) and
  20 pt (regular width) side margins are UIKit's system minimum layout
  margins, which the owner asked for: content on an upright iPhone is 16 from
  the safe edge, 20 when turned sideways; the iPad's page margin (48, 32 on
  the wide views) is already above 20.

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

- **Margins on the phone.** The task list no longer hangs 8 pt into the
  margin (`-mx-2` was for the Mac's hover background): checks, section
  headings, "Today's goal" and Add task sit on the 16 pt margin, aligned
  with the large title. A swipe row runs edge to edge with the margin inside
  it, as iOS's rows do, so the check's tap area is not cut at the margin.
  New Task sits on the margin too (it was 12 in).

## Rulings made while building

- Ruling: the horizontal clip is on the app's frame
  (`[data-slot=sidebar-wrapper]`), not `body` — `body`'s overflow is handed to
  the viewport, and Chromium widened the mobile layout viewport to 448 all the
  same. Cost if wrong: none seen; `clip` makes no scroll container, so sticky
  headings still stick.
- Ruling: Timeline's own buttons (View, Group by project, zoom, the no-date
  panel) are left alone — the Timeline screen belongs to another branch. It
  still gets the shared Today and Filter buttons and the sidebar toggle,
  which live in this change's files. Cost if wrong: those four stay 28–32 pt
  on touch until that branch takes them.
- Ruling: an iPad task row is 48 pt tall (`py-3.5` on the tablet layout) so
  the check's 44 pt tap area is not cut by the next row. Cost if wrong: an
  iPad list shows a little less per screen.
- Ruling: the long-press menu is kept from starting on the tab bar and New
  Task by stopping their pointer-down and contextmenu from reaching the
  window-wide menu trigger.
- Ruling: `HeaderButton` is shared, so Notes' "New note" in its header gets
  the 44 pt height on iPad too. That helps M08 and changes nothing else there.

## Not done here (deferred)

- M29's space taken by the bars in landscape (fold New Task into the nav bar):
  a layout decision for the owner, not a sizing fix. The long press on the tab
  bar opening the page menu is fixed.
- M30, wrapping Timeline titles: the Timeline belongs to another branch.
- M22's "Delete Task under the home indicator": the sheet already pads its
  end by the safe area; the button is under it only because the sheet is
  longer than the screen and scrolls.
- M11 follow-up: open the phone's task sheet as a centred form sheet on the
  iPad (44 pt rows, subtasks, status, focus and goal already in it). Likely
  the better design; a redesign the owner should see on its own.

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

All in Chromium's touch emulation (`isMobile`, `hasTouch`) with the safe areas
an iPhone reports injected, on the built UI with stubbed `/api`:

- `ui/checks/touch-sizes.cjs` fails on `origin/main` (22 failures, also after rebasing on main at 1eef78e: Today inset
  12, pushed screen at scrollY 727, back 63x28, Time sheet page 587 wide,
  remove 28x28 at x=451, Cancel/Done 52x22 / 42x22, iPad checks 41x33,
  toggle at x=-8 and 28x28, day arrows and Timeline Today/Filter 28 tall) and
  passes on this branch.
- Re-measured each finding before and after at 390x844, 844x390, 820x1180 and
  a 1440x900 mouse: back 63x28 → 71x44; ⋯ 32 → 44; menu rows 28 → 44; task
  sheet Cancel/Done 22 → 44 tall, selects 22 → 43; pushed screen scrollY
  727 → 0; Time sheet viewport 562 → 390 with every control on screen; iPad
  checks 18 (hit 41x32) → 22 (hit 45x44), toggle x=-8 → 20 and 44x44, day
  arrows and header buttons 28 → 44; tab bar long press menu 1 → 0.
- Margins (first and last drawn content, from the screen edge): Today
  12/50 → 16/46 at 390, 59 → 67 (47 safe + 20) at 844; Time sheet 16/141 →
  16/81; Settings 16/58; task sheet in landscape 16 → 67 from the edge.
- Desktop 1440x900 with a mouse: every measurement equal and the five
  screenshots byte-identical before and after.
- `npm run typecheck`, `npm test` (689, after rebasing on main), `npm run build` green.

Not verified: WebKit and a real iPhone or iPad (safe areas there come from
the device, not injected values), and anything with the on-screen keyboard up.
