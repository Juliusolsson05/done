# Board drag follow-ups: a second finger, the Filter popover, a sideways title

Issue #123. Branch `feat/board-drag-followups`. Follows
`2026-11-27-board-heights.md` (#116, merged as 160f253).

## Outcome

While a card is held, nothing else on the page reacts to a second finger;
pressing a card closes an open Filter popover as any outside press does; a
phone held sideways still names the Board in its navigation bar.

## Findings (second review of #116)

- N1: `onPress` in `board.tsx` returns early for a press while another is
  held before it calls `stopPropagation()`. The second finger's pointerdown
  reaches the context menu's trigger, whose own long-press timer opens the
  menu after ~700 ms, mid-drag; the open menu then takes the pointer, and the
  drag drops nothing.
- N2: on an iPad the Filter is a popover. Its outside-press dismissal listens
  on the document for pointerdown, and a finger's pointerdown on a card is
  stopped from bubbling (so the page's long press does not start), so the
  popover stays open; after a hold and release the popover and the card menu
  are both open.
- N3: sideways on a phone (under 500 px tall) the Board hides its large title.
  The navigation bar's small title only appears once the window has scrolled
  the large title away, and the Board's window never scrolls, so no title
  shows at all.

## Decisions

- N1: stop a finger's pointerdown from bubbling before any early return.
- N2: when a finger presses a card, the Board closes the Filter
  (`setFilterOpen(false)`), as the press outside it would have. The Filter is
  the only popover on the Board.
  Ruling: not a synthetic `pointerdown` sent to the document. Tried first; this
  Radix version defers a primary-button outside press until a click, so it
  closed nothing. Cost if wrong: a popover added to the Board later must be
  closed here too.
- N3: `PhoneHeader` treats a large title that is not drawn (hidden by its
  view) as scrolled away, so the small title shows; it measures again when
  the window is resized (turning the phone).

## Checks

Added to `ui/checks/board-heights.cjs`, each failing on origin/main 160f253:
- 820x1180 and 390x844 by touch: a second finger resting 900 ms on another
  card while one is held opens no menu, and the held card still lands.
- 820x1180: with the Filter popover open, holding a card closes it.
- 844x390: the navigation bar shows "Board".

## Rulings

- Ruling: CI does not run `ui/checks/*.cjs`; they need a local Chrome (or
  WebKit) through Playwright, and are run by hand against a build before a
  PR. Why: CI has only Node and Rust set up, and a browser in CI is its own
  change. Cost if wrong: a regression in the Board's drag or heights is only
  caught when someone runs the check.
- Ruling: after PR #119 (44 pt targets and iOS margins, open at the time of
  writing) merges, re-check the Board sideways against its 20 px landscape
  margin and 44 pt Add task and Filter buttons: the reviewer expects the
  board's `max-md:-mx-4 max-md:px-4` bleed (16 px) to mismatch the new
  margin. Not done here, since #119 is not merged.

## Verified (Chrome via Playwright, built UI, mocked `/api`)

- `ui/checks/board-heights.cjs`: 6 failures on origin/main 160f253 (N1: no
  menu and the drop landing, on iPad and phone; N2: the popover closing on a
  hold; N3: the title); all 93 assertions pass on this branch.
- 844x390: the navigation bar shows "Board" (screenshot taken).
- `npm run typecheck && npm test && npm run build` green (714 tests).

## Not verified

- A real iPhone or iPad: only Chrome's touch emulation.
- The landscape margins against #119, which is not merged yet (see Rulings).
