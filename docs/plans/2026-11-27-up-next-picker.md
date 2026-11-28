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
- **Length**: a block starts at the length last chosen for focus (the
  remembered one); choosing a length in Up next is for that block and does
  not change the Focus page's. After Add the panel is ready for the next
  block: no task, the same length.
- **Queued list**: number, title, length, then move up, move down and remove;
  on touch those are 44 px. A list labelled "Queued blocks". The total
  ("1 h 25 min planned") stays.

## Review fixes

From the review of #122, after rebasing onto origin/main (ab2c64b):

- **iPad**: on touch the panel is 448 px (`max-w-md`) instead of 384, and a
  queued title wraps to two lines before it is cut.
- **The picker's phone sheet is named for its place**: `FocusPicker` takes a
  `title`; Up next's says "Add a block".
- **Recent is read when a picker opens**, not when it mounts, and kept for
  the next opening; it is read again once a block is written to the time
  sheet (`onRecorded`), also while a picker is open. Checked: opening Up next
  reads nothing; the first picker opening reads 7 days; a second reads none.
- **Enter in Other's minutes field adds the block** when a task is chosen.
  `Length` takes an optional `onEnter`, called from the field's own Enter
  (not from Set). The Focus page passes none, so there Enter only sets the
  length, as before.
- **Ids without a secure context**: `newId` (`ui/src/lib/ids.ts`, tested)
  uses `crypto.randomUUID` where the page has it and `getRandomValues`
  otherwise. Used for reminders and blocks (`focus-store.ts`) and for the
  window's owner id in `backend.ts` (that line only; the Apple session watch
  there runs only in the app, which is always a secure context). Checked on
  `http://done.test` (`isSecureContext` false): a block and a reminder add.
- **Blocks whose task went away**: `blockTask` and `nextBlock` in
  `lib/focus.ts` (tested). A queued block whose task was finished or deleted
  meanwhile is struck through and says "Done · skipped" or "Deleted ·
  skipped", and is left out of the planned total. Start next starts the first
  block still to do and takes the skipped ones off the list, instead of
  running a block on no task under its old title. They are judged against
  every task (`data.tasks`), so a block is never skipped for being outside
  the view on screen; Start next used the view's tasks before.

Ruling: skip rather than ask — a block whose task is done has nothing left
to do, and a question at the moment time runs out is one more thing to
answer — cost if wrong: someone who wanted to keep working on a task they
had ticked off starts it from the picker instead.

## Tests

- `ui/src/lib/focus-picker.test.ts` already covers the order, matching and
  exclusions that Up next now shares.
- New committed check `ui/checks/up-next-picker.cjs` (Playwright, Chrome, the
  built UI on a faked API): at 1280x800 and 390x844 with touch it opens Up
  next, types "invit sketch", chooses the one match, picks 45 min, adds, sees
  the block queued and saved, checks the row's buttons are 44 px on touch,
  and removes it. On origin/main it fails at the picker (checked).

Ruling: Add is a button, not a form submit — the picker's and Other's
buttons sit inside the add area, and a `<button>` in a form submits it unless
told otherwise (both now say `type="button"` as well) — cost if wrong: Enter
in the add area no longer adds; the picker's own Enter chooses a task.

Ruling: the check serves the faked app as `http://localhost:4499` rather than
`done.test` like the notes checks — a block's id comes from
`crypto.randomUUID`, which only a secure context has, and the app always runs
in one — cost if wrong: none; nothing listens on that port, Playwright
answers every request.

## Verification

- `npm run typecheck`, `npm test` (729), `npm run build` pass.
- `ui/checks/up-next-picker.cjs` passes at 1280x800 and 390x844 (touch).
  Against origin/main's source it fails: no "Find a task" field (checked).
- Driven in Chrome on a faked API with three queued blocks, at 1280x800,
  820x1180 and 390x844 (touch for the last two), before and after
  screenshots:
  - the picker opens over the panel (popover; top sheet on a phone),
    "invit sketch" finds one task, Escape closes only the picker;
  - row buttons are 28 px with a mouse and 44 px on touch; move down
    reorders; the list sits 16 px from each side; on a phone the panel is
    the full 390 px;
  - Done closes the panel; Start focus, then Up next from the header during
    the session shows the queue; after Stop, "Start next: Fix sign-in on
    iPad · 25 min" starts that block;
  - no horizontal scroll at any size.

Not verified: a real iPhone or iPad keyboard over the picker and the Other
minutes field, and the home-indicator padding on a real device (the
emulator has no safe area).
