# The Board fills its view, and cards move between columns by mouse and by touch

Issue #110. Branch `feat/board-heights`.

## Outcome

The Board takes the height the view actually has. Each column scrolls on its
own, every column is a drop target from its heading to the board's bottom, and
a card anywhere in a long column can be moved into a short or empty one: with a
mouse on the Mac, and by press and hold then drag on an iPhone or iPad.

## Confirmed scope

The owner's own words, which are the acceptance cases:

1. "If In progress has 5 items and I have 50 in To do, I scroll down and I
   cannot drag it over." With a long To do and a short In progress, scrolled
   to a card low in To do, there is no In progress under the pointer.
2. "The dragging does not work on the phone or tablets either." Touch drag
   between columns does nothing on iPhone or iPad.

## Evidence (origin/main cbd6ee3, local preview, seeded board)

40 cards in To do (long titles, subtasks, two projects), 3 in In progress,
Done empty. Chrome through Playwright, sidebar open and closed.

- 1440x900, 1280x600, 1024x500: the page (`main`, `overflow-y-auto`) scrolls
  2994 / 3114 / 3474 px in a 900 / 600 / 500 px window. Columns are
  `items-start`, so they are only as tall as their cards: In progress ends at
  ~380 px, empty Done at 254 px. A drop low in Done misses.
- iPad 820x1180 and 1180x820: the same layout and the same misses. Touch drag:
  nothing. The cards use HTML5 drag and drop (`draggable`), which a finger
  does not start; the subtitle tells the phone to use the long-press menu.
- iPhone 390x844 and 844x390: one column under another, the window scrolls to
  3637 / 3337 px, empty Done below all of To do. Touch drag: nothing.
- Tab bar: no card ends up under it (the phone page keeps 8rem of bottom
  padding). Not a symptom today; the fix must keep it so.
- Seen while measuring, not fixed here: with Chromium's mobile emulation
  (`isMobile`), any pushed phone screen (Board, Time sheet, Completed) widens
  the layout viewport during the push animation (417 px, Board 489 px), which
  puts the fixed tab bar below the screen. Not reproduced without `isMobile`,
  and not seen on a device; noted for a separate look.

## Decisions

- **Height like the Timeline's.** In a window (Mac, iPad) the page box is a
  flex column of the screen's height; the Board becomes `flex min-h-0 flex-1
  flex-col` in it, as the Timeline and Focus are, and the columns stretch to
  the bottom. On a phone the window scrolls, so nothing above bounds the view:
  it is given the screen from below the navigation bar to the tab bar, the
  same `calc(100svh - …)` the touch Timeline uses, and the page's bottom
  padding for the tab bar is given back so the window does not scroll.
- **Each column scrolls itself**, its heading held at the top, with
  `overscroll-contain` so a column's end does not drag the page.
- **The phone gets columns side by side**, 85% of the width each, scrolled
  sideways with snapping (as Trello and Linear do on a phone), so every column
  is full height and the next one peeks in. Stacked full-height columns would
  each need the whole screen and put Done two screens away.
- **Mouse on the Mac stays HTML5 drag and drop**, unchanged; only the drop
  targets grew. The desktop Board at 1440x900 looks as before apart from the
  columns reaching the bottom.
- **Touch (and any pointer on a touch layout) uses pointer events**, with the
  Timeline's hold rule (`lib/timeline-press.ts`: hold `HOLD_MS` still, a finger
  that moves first is a scroll). After the hold the card lifts, a copy follows
  the finger, the column under it is lit, and letting go moves it there
  through the same code as a mouse drop (`update`/`complete`, so `change()`
  and undo). A non-passive `touchmove` listener stops the page scrolling while
  a card is held, as on the Timeline.
- **Auto-scroll while dragging by touch:** near the top or bottom of the column
  under the finger it scrolls that column; near the left or right edge on a
  phone it scrolls the columns sideways. The speed rule is plain data in
  `lib/board-drag.ts`, with a test.
- **The long-press menu stays.** A held card that is let go where it was does
  nothing; a hold that does not move still lets the menu open.

## Checks

- `ui/checks/board-heights.cjs` (Playwright, built UI, mocked `/api`; 50 in
  To do, 5 in In progress): at 1280x600, 390x844 (touch) and 820x1180 (touch)
  the document and the page do not scroll, every column ends within 2 px of
  the board's bottom and above the tab bar; mouse: the 45th To do card onto
  In progress, a card low into empty Done; touch: To do onto In progress,
  To do into off-screen Done by holding at the edge (phone), To do into Done
  (iPad), and 844x390 by touch. On origin/main: 22 failures.
- `npm run typecheck && npm test && npm run build`.

## Rulings made while building

- Ruling: on an iPhone or iPad every pointer goes through the hold path, and
  cards are not `draggable` there — an iPad's trackpad would otherwise have
  had no way to drag at all, and iOS's own drag of a `draggable` element would
  fight the hold. A mouse or trackpad lifts the card once it moves past
  `SLOP`, so a click still opens the task. Cost if wrong: iPad trackpad drags
  feel slightly different from the Mac's (a copy follows instead of the
  system's drag image).
- Ruling: on a phone the board has no minimum height (`max-md:min-h-0`).
  Sideways (844x390) the 160 px minimum pushed Add task under the tab bar;
  without it the columns are 144 px tall there, and still scroll and take
  drops. Cost if wrong: short columns in landscape, which is a rare way to
  use the Board.
- Ruling: phone columns are 85% wide but at most 384 px (`max-w-sm`), so a
  phone held sideways shows two columns instead of one 690 px wide.
- Ruling: the check runs phones with `hasTouch` but without Chromium's
  `isMobile`, because of the layout viewport widening noted above.

## Verified (local preview, Chrome via Playwright, seeded board)

- `ui/checks/board-heights.cjs`: all pass on this branch; 22 failures on
  origin/main with the same check (every drag case and every height case).
- Every viewport, sidebar open and closed: the document and the page do not
  scroll; all three columns end at the board's bottom (1440x900: 804 px,
  1280x600: 504, 1024x500: 404, iPad 1084 / 724, iPhone 743 / 289); a drop
  low in the empty Done column lands (mouse on the Mac, trackpad path on the
  iPad layouts, touch in the check).
- Touch: a hold of a second without moving still opens the long-press menu,
  and the lifted copy is gone after letting go; a sideways swipe on a card
  moves to the next column on a phone (scrollLeft 0 to 316, one column);
  a vertical swipe scrolls the column (0 to 325); a tap opens the task;
  a held card at a column's bottom edge scrolls it (840 px in a second).
- Desktop at 1440x900 matches the before screenshot apart from the columns
  reaching the bottom (same column positions, widths and cards).
- `npm run typecheck && npm test && npm run build` green (643 tests).

## Not verified

- A real iPhone or iPad, and the Mac app's WebKit view: only Chrome's touch
  emulation. iOS's own long-press timing against the 380 ms hold, haptics
  on lift, and `100svh` with the real safe areas need a device.
- Auto-scroll near an edge with a mouse on the Mac uses the browser's own
  drag auto-scroll; Playwright's emulated drag cannot show it. With
  full-height columns it is no longer needed to reach a column.
