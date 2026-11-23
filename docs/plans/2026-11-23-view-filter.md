# Board and Timeline: filter by project, priority, date and words

Fixes #45.
Branch `feat/view-filter` · Worktree `../done-wt/view-filter` · Base `origin/main` @ eb11d91 (2026-11-23)
Status: building with the defaults below, agreed in chat ("sure lets do that"); the owner previews it locally before anything merges. Size: standard plan.

## Outcome

A Filter button in the Board's and the Timeline's header narrows both to the tasks that matter now: chosen projects, priorities, a time window, words. What is filtered stays in sight as chips under the title, with a count, and is one click from gone.

## Evidence (verified, do not re-derive)

- Board: `ui/src/components/board.tsx` draws `lanes(data.tasks, TODAY)` (`ui/src/lib/tasks.ts`): to do and in progress from open top-level tasks, done from those finished today. Drag and drop changes status through `update`.
- Timeline: `ui/src/components/timeline.tsx` draws `timelineGroups(projects, tasks, order)`; its header already has the Group by select and day buttons.
- Quick add on both pages picks its project from the view (`quick-add.tsx` `defaults`: a project view gives its project, else none).
- Right-click on a sidebar project opens `ProjectMenu` (`app-menu.tsx`).
- No popover component exists in `ui/src/components/ui/`; `radix-ui` (installed) exports Popover. A `sheet` component exists for phones.

## Decisions

1. **One filter for Board and Timeline**, remembered on the device (`done-view-filter`). Default, agreed.
2. **Filter by:** projects (several, Inbox included), priority (P1, P2, P3, none), when (any, late, due today, this week, next two weeks, no date), words in title or notes. Default, agreed.
3. **`F` opens the filter** on the Board and the Timeline. Default, agreed.
4. **Right-click a project → Show only this on the Board / on the Timeline.** Default, agreed.
5. **Quick add follows the filter:** with exactly one project chosen, a new task goes into it.
6. **Phone:** the filter opens as a sheet from the bottom.

Ruling: "this week" is due from today through the next six days, and "next two weeks" through thirteen; neither includes late tasks, which have their own choice — cost if wrong: a late task is hidden under "this week", one click on Late shows it.
Ruling: a finished task (the Board's Done today column) is filtered by project, priority and words, and by "when" on its due date like any other — cost if wrong: Done today can look emptier than expected under Late.

## Design

- `ui/src/lib/view-filter.ts` (pure, tested): `ViewFilter { projects: (number | null)[]; priorities: number[]; when: When; words: string }`, `NO_FILTER`, `isFiltering`, `matchesFilter(task, filter, today)`, `filterChips(filter, projects)` (label and the filter without it), `cleanFilter(stored, projects)` (anything unreadable or naming a deleted project is dropped), `onlyProject(filter)`.
- `ui/src/lib/view-filter-store.ts`: the shared filter and whether its panel is open, in browser storage, read with `useSyncExternalStore`.
- `ui/src/components/ui/popover.tsx`: shadcn's popover on `radix-ui`.
- `ui/src/components/view-filter.tsx`: `FilterButton` (popover; sheet on a phone) and `FilterBar` (chips, count, Clear).
- `board.tsx`, `timeline.tsx`: filter before laying out; empty state when nothing matches.
- `quick-add.tsx`: project from the filter on these pages.
- `App.tsx`: `F`. `app-menu.tsx`: the two Show only items.

Invariant: filtering only changes what is drawn; no task is written by it.

## Tests

- `view-filter.test.ts`: each dimension alone and together; words in notes; when-windows at their edges and late; finished tasks; chips remove only themselves; a stored filter with a deleted project or junk is cleaned; `onlyProject`.

## Verification

Checks in AGENTS.md; browser preview on a copy of the owner's tasks (desktop and a 393-point phone frame): filter by Hop, add P1, chips and count, clear, drag on the Board with a filter on, `F`, right-click Show only, quick add into the filtered project.
Not verified here: the iPhone itself.

## Out of scope

Filtering by person (tasks have no assignee), saved named filters, filtering the list views (Today, Upcoming).

## Execution notes

- Review round (one reviewer, read-only, both branches): nothing serious. Fixed here: quick add on a filtered page now also takes the one priority and a date inside the time window, so a task added under "Due today" or "P1" stays on the page (before, only the project was carried); "this week" and "next two weeks" count a task whose span reaches into the window, as its Timeline bar does; a stored `when` is checked against the filter's own choices (`"toString"` passed `in` and hid everything); repeated ids in a stored filter are dropped.
- Ruling (replaces the earlier one on windows): a task counts for "this week" or "next two weeks" if any of its days, start to due, fall in the window; late tasks stay their own choice — cost if wrong: a long task shows under "this week" a while before it is due.
