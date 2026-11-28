# Up next: the Focus picker, and a tidier panel

Issue #121.

## Outcome

In Up next, "Add a block" uses the same searchable task picker as the Focus
page (#103): type to find by title or project, in the same order under the same
headings, with each task's project and due day. A block is added by choosing a
task, then a length (25 min, 45 min, 1 h, Other), then Add. Queued blocks are a
plain numbered list whose move and remove buttons are 44 px on touch. On a
phone the panel fills the screen with 16 px margins.

## Evidence

The owner: "the up next has same shitty UI as the task picker had to begin
with." `ui/src/components/up-next.tsx` still has a Radix `Select` of titles over
`focusTasks()`, a bare minutes field, and 28 px icon buttons. On a phone the
panel is a 3/4-width side sheet, so queued titles truncate to "Write the la…".

## Decisions

- **One picker.** `FocusPicker` (`ui/src/components/focus-picker.tsx`) is used
  as it is. It now reads the tasks, today's goal and the recently focused
  tasks itself (`useApp`, the time sheet), so the two places that use it only
  pass the chosen task and what to do with a choice. Ordering and matching stay
  in `pickerGroups`; nothing is copied.
- **One length control.** `Length` moves out of `focus-view.tsx` into
  `ui/src/components/focus-length.tsx`, taking its label id, the chosen
  length and what to do with a new one. The typed-minutes rule from #103's
  review stays: a usable number typed under Other wins.
- **Which tasks**: the picker's rules (open tasks, no finished ones, no
  subtasks). A task already queued can be queued again, as today.
  "Nothing in particular" stays.
- **Phone**: the panel is the full width of the screen, with its own Done
  button (44 px) instead of the small corner X, and scrolls inside itself
  with room for the home indicator. The picker inside it is the same top
  sheet as on the Focus page.
- **Queued list**: number, title, length, then move up, move down and remove;
  on touch those are 44 px. A list labelled "Queued blocks". The total
  ("1 h 25 min planned") stays.

## Tests

- `ui/src/lib/focus-picker.test.ts` already covers the order, matching and
  exclusions that Up next now shares.
- New committed check `ui/checks/up-next-picker.cjs` (Playwright, Chrome, the
  built UI on a faked API): at 1280x800 and 390x844 with touch it opens Up
  next, types "invit sketch", chooses the one match, picks 45 min, adds, sees
  the block queued and saved, checks the row's buttons are 44 px on touch,
  and removes it. On origin/main it fails at the picker (checked).

## Verification

To be filled in at the end.
