# Find the task to focus on by typing, on a calmer Focus page

Issue #102.

## Outcome

On the Focus screen, "What are you working on?" opens a picker you can type
into. "invit sketch" finds "Sketch the invitation"; "wedd" finds every task in
Wedding. With nothing typed, the list is in an order worth reading: today's
goal, the rest of Today, overdue, coming up soon, recently focused, then
everything else, under short headings. Finished tasks never show.

## Scope change: the whole idle Focus page

Recorded during the build. The owner: "The focus menu is not clean and bloated
in the focus page as well." The idle page showed a picker, seven length chips
and a minutes field, a reminders form, Start focus and Up next all at once.

- The page now shows the picker, three lengths (25 min, 45 min, 1 h; `COMMON`
  in `lib/focus.ts`) and "Other", and Start focus as the one main button.
- "Other" opens a small popover with the other presets (15 min, 30 min,
  1.5 h, 2 h) and a minutes field. When the chosen length is one of those, the
  button is pressed and names it ("1 h 30 min").
- The chosen length is remembered in this browser's storage
  (`done-focus-minutes`, `storedMinutes`/`rememberMinutes` in
  `lib/focus-store.ts`), so "Other" still says "1 h 30 min" after a reload.
- Reminders and Up next sit under one "Options" line, folded. Folded, it says
  what is set (`optionsSummary` in `lib/focus.ts`): "Stand up and stretch every
  30 min", "2 reminders", "1 block up next". Up next leaves the header before a
  session; during one it stays in the header, as before.
- Two taps at most: Other then a preset; Options then a reminder field or Up
  next. "Start next" still appears beside Start focus when blocks are queued.
- On touch layouts the length buttons and Start focus are 40-44px tall.

Ruling: the chosen length is kept per browser, not in the tasks file — it is
a preference of this window, like the reminders list — cost if wrong: a length
chosen on the Mac is not the one offered on the iPhone.

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
- **The list stops above the keyboard.** iOS shrinks the visual viewport for
  the keyboard, not the page, so the list's height is set from
  `window.visualViewport` and kept up to date while it is open.
- **On iPhone and iPad the field has a Close button** beside it: a finger has
  no Escape key and tapping outside is not obvious.

Ruling: the Up next panel's own "Add a block" picker stays a plain select — the
owner named the Focus picker, and that panel is a separate place — cost if
wrong: a second, smaller raw list to replace later with the same `Finder`.

## Tests

`ui/src/lib/focus-picker.test.ts`, on a realistic list (a wedding, a launch,
home chores; a finished task with a similar title; a subtask):

- empty query: group order and headings, goal first, finished and subtasks out;
- recent group: newest first, no task twice, finished ones dropped;
- matching: word order, case, accents, project name, nothing matches;
- title matches before project-only matches;
- `optionsSummary` (in `focus.test.ts`): nothing set, one or several
  reminders, blocks up next.

Reverting `pickerGroups` to a pass-through fails 12 of its 13 tests (checked).

## Verification

- `npm run typecheck`, `npm test`, `npm run build` in `ui/`.
- The UI (Vite dev server on this branch's source) driven with Playwright (Chrome) at 1280x800, 820x1180 and
  390x844 with touch, on a temp database: typing, arrows, Enter, Escape, tap,
  Close, Q/N/digits staying in the field, row heights. Before and after
  screenshots.

Done: typecheck, 648 tests and the build pass. Driven in Chrome (Playwright)
on a temp database with realistic tasks, at 1280x800, 820x1180 and 390x844
(touch for the last two): "invit sketch" finds only "Sketch the invitation";
typing "q1n" stays in the field; option rows are 50px; ArrowDown moves
`aria-activedescendant`; Enter (desktop) and tap (touch) choose; Escape and
Close close; the picker opens on the chosen task; "Other" then "1.5 h" names
the length and it survives a reload; Options shows the reminder line; Start
focus runs a session on the chosen task for the chosen length, with Up next in
the header; no horizontal scroll at any size.

Not verified: a real iPhone or iPad keyboard. The phone sheet is placed at the
top and the list is sized from the visual viewport, but WebKit's keyboard was
not run, nor whether iOS raises the keyboard for the field's autofocus after a
tap (it may need a second tap into the field).
