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
- **Pushed screens open at the top; Back returns where you were.** On a phone,
  opening a pushed (non-tab) screen — `openView`, or `reveal` from search when
  it changes the page — saves the page being left in a `Map` ref keyed by its
  place in the back history (depth and page), and the new page starts at 0;
  `back` (the button and the edge swipe) restores the position saved for the
  place it returns to. Keying by place, not page alone, means Lists → a list →
  Lists → another list returns each Back to its own Lists. Switching tabs
  behaves as on main (scroll untouched). Review of #119 caught the first
  version resetting the previous list to 0 on Back, and the second missing
  `reveal`.
- **iPad sidebar toggle.** On touch the toggle starts the page's existing
  header row (`ViewHeader`), as iPadOS bars put it, with `-my-1.5` so the
  header is no taller than main; a page without a `ViewHeader` (a note open in
  Notes) keeps a 44 pt row of its own. On Board and Timeline it starts at the
  margin rather than reaching 12 into it, since their page clips there (the
  tap area was 33x45). The Mac keeps the margin button. (The
  first version gave the toggle its own row everywhere, pushing every header
  down 52 px.)
- **Long-press menu** rows get `pointer-coarse:min-h-11` and body text, in the
  shared context-menu primitive (the same pattern the notes Lists menu uses);
  on a touch screen under 500 tall (an iPhone on its side) rows are 36 so
  nine fit, and the menu's collision padding is the `--safe-*` insets plus 8,
  so it never runs under the status bar, notch strip or home indicator.
- **iPad task editor** keeps the inline editor; each control gets
  `pointer-coarse:h-11`. Follow-up (not here): opening the phone's sheet as a
  centred form sheet on the iPad is probably the better design, since it
  already has 44 pt rows and the long-press actions; it is a redesign, and the
  owner should see it on its own.
- **Settings in a browser** shows the agent (terminal) pane only with a fine
  pointer (a mouse), however narrow the window. The download pane is PR #99's
  `DesktopDownloads`, ungated: it reads the operating system and on a phone
  or iPad says to use done in the browser instead of offering the Mac app,
  which is what the audit asked for (decided in review).
- **Push animation overflow**: `overflow-x: clip` on the app's frame on a
  phone, so a page sliding in cannot widen the layout viewport.
- **Landscape**: the task sheet keeps its content inside the side safe areas;
  the tab bar, New Task and the navigation bar no longer start the page's
  long-press menu.
- **Time sheet** block with an empty title reads "No title".
- **Tab bar height**: the tab bar and New Task use `--tab-bar` (and the page
  `--phone-nav` / `--phone-page-end`) from the Board PR #116, which merged
  first; no competing values here.

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
- Ruling: an iPad task row is 44 pt (`min-h-11 py-2.5` on the tablet layout),
  as tall as the check's tap area, and the list's groups sit 20 apart instead
  of 28 on the tablet layout, so 22 rows show at 820x1180 (main 25 at 38 pt;
  the first version's 48 pt rows and toggle row showed 17). 20 is the review's
  middle ground; it keeps exactly 22 rows (the 22nd ends at 1180), so any
  taller element above the list drops one. Cost if wrong: a little tighter
  grouping on iPad.
- Ruling: the long-press menu is kept from starting on the tab bar, New Task
  and the navigation bar: their contextmenu (what a browser's long press and a
  right click send) is stopped from reaching the window-wide menu trigger, and
  so is a touch's pointer-down, which starts Radix's own press timer.
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
  UI with stubbed `/api`, waiting on conditions (animations finished) rather
  than sleeps, with role-based locators. At 390x844: 16 pt margins on Today,
  Lists, Settings and Time sheet; a list pushed from Lists scrolled to 300
  opens at 0 and Back returns to 300; back button and task-sheet Cancel/Done
  ≥ 44; a long press on the navigation bar opens no menu; Time sheet fits,
  remove buttons 44 and on screen, an empty title reads "No title". At
  844x390: margins ≥ 47 + 16, the long-press menu fits between the insets
  without scrolling (Delete visible), the task sheet clear of the notch. At
  820x1180: ≥ 22 Today rows in view and the title no lower than main, check
  tap areas ≥ 44 (measured with `elementFromPoint`), sidebar toggle on screen
  and 44 on Board, Timeline and Time sheet, header buttons 44. A 700 wide
  mouse window keeps "Connect an AI agent" and "Mac app". Mouse windows at
  1440, 1024 and 800: checkbox 18, title at y=40, no header toggle, day arrow
  28, menu rows 28, Time sheet a table.
- `npm run typecheck && npm test && npm run build`.
- A 1440x900 mouse pass comparing screenshots and sizes before and after.

## Verification

All in Chromium's touch emulation (`isMobile`, `hasTouch`) with the safe areas
an iPhone reports injected, on the built UI with stubbed `/api`:

- `ui/checks/touch-sizes.cjs` fails on `origin/main` 717e7c7 (31 failures),
  on the second review's head (3: Back after a search result returned Lists
  at 300 not 600, Timeline toggle tap area 33x45, an untitled block's remove
  button unnamed)
  and on this PR's first head (9 failures, one per review item: Back returned
  Lists at 0, long press on the bar, no "No title", landscape menu 390 tall
  and scrolling with Delete at y=374, iPad 17 rows and title at y=116, the
  700 wide mouse window's two panes), and passes on this branch.
- Review fixes, measured: Back after Lists at 300 — main 300, first head 0,
  now 300. iPad 820 Today — main 25 rows, title y=64; first head 17 rows,
  y=116; now 22 rows, y=64.
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
- `npm run typecheck`, `npm test` (736, on main 717e7c7), `npm run build` green.

Not verified: WebKit and a real iPhone or iPad (safe areas there come from
the device, not injected values), and anything with the on-screen keyboard up.
