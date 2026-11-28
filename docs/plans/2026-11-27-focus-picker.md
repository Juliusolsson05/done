# Find the task to focus on by typing

Issue #102.

## Outcome

On the Focus screen, "What are you working on?" opens a picker you can type
into. "invit sketch" finds "Sketch the invitation"; "wedd" finds every task in
Wedding. With nothing typed, the list is in an order worth reading: today's
goal, the rest of Today, overdue, coming up soon, recently focused, then
everything else, under short headings. Finished tasks never show.

## Evidence

The owner: "the picker for the focus is complete dog shit, rework that, it is
no search just a raw list." Today it is a Radix `Select` in
`ui/src/components/focus-view.tsx` over `focusTasks()` (`ui/src/lib/focus.ts`):
goal, then due today or overdue, then the rest by priority, titles only. Two
tasks with similar titles ("Sketch the invitation", "Sketch the invitation
envelope") cannot be told apart, and a Select has no field to type in.

## Decisions

- **The rules live in `ui/src/lib/focus-picker.ts`**, plain data in and out:
  `pickerGroups(tasks, projects, today, query, recent, goalId)` returns groups
  of rows with headings. The component only draws them and moves the cursor.
- **Matching reuses `fold`/`matchesQuery` from `ui/src/lib/search.ts`** (the
  app-wide search): every word somewhere, any order, case and accents ignored.
  A task is matched on its title and its project's name ("Inbox" for none).
  Title matches come before project-only matches; within each, the same order
  as the empty list.
- **Recently focused comes from the time sheet** (`loadEntries` for the last
  seven days, read when the Focus screen opens), newest first. It is true on
  every device, unlike something kept in this window's storage. If it fails to
  load, the group is just missing.
- **Subtasks stay out**, as today: focus is on a task, and `openTasks` already
  leaves subtasks and finished tasks out.
- **"Nothing in particular" stays**, first in the list with nothing typed.
- **One field, two containers.** A window or iPad gets a popover under the
  button. A phone gets a sheet from the top: the field and the first rows sit
  above where the keyboard comes up, and it has a Close button.
- **Accessibility**: the field is a `combobox` with `aria-controls`,
  `aria-expanded` and `aria-activedescendant`; the list is a `listbox` of
  `option`s, grouped with `role="group"` and a label. The app's single-key
  shortcuts already ignore keys typed in an input or a combobox (`App.tsx`).
- No new dependency: Radix Popover and the existing Sheet.

## Tests

`ui/src/lib/focus-picker.test.ts`, on a realistic list (a wedding, a launch,
home chores; a finished task with a similar title; a subtask):

- empty query: group order and headings, goal first, finished and subtasks out;
- recent group: newest first, no task twice, finished ones dropped;
- matching: word order, case, accents, project name, nothing matches;
- title matches before project-only matches.

Reverting `pickerGroups` to a pass-through fails them.

## Verification

- `npm run typecheck`, `npm test`, `npm run build` in `ui/`.
- The built UI driven with Playwright (Chrome) at 1280x800, 820x1180 and
  390x844 with touch, on a temp database: typing, arrows, Enter, Escape, tap,
  Close, Q/N/digits staying in the field, row heights. Before and after
  screenshots.

Not verified: a real iPhone keyboard (the sheet is placed at the top so the
keyboard cannot cover the field, but the WebKit keyboard itself was not run).
