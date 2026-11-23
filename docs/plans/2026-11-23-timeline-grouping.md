# Timeline: group by project or by date

Fixes #38.
Branch `feat/timeline-grouping` · Worktree `../done-wt/timeline-grouping` · Base `origin/main` @ 56eacdb (2026-11-23)
Status: building with the defaults below; the owner sees a preview before merging. Size: short plan.

## Outcome

A "Group by" control in the Timeline header switches between **Project → date** (as today) and **Date → project**: every dated task in one list in date order, tasks on the same day ordered by project. The choice is remembered on the device.

## Evidence (verified, do not re-derive)

- `ui/src/lib/tasks.ts` `timelineGroups(projects, tasks)` makes one group per project (Inbox first), dated tasks first in start-date order, undated after. `ui/src/components/timeline.tsx` draws a header row per group (project dot, name, count) and a `Row` per task. Its only test is in `tasks.test.ts` ("lists Inbox first, skips empty projects…").
- Rows and drags do not depend on the grouping: a `Row` takes a task and the visible days.

## Decisions

1. **Date → project layout** — *Default: one group of dated tasks in start-date order (same day: project order, Inbox first, then priority), then "No date"*, because the bars already lay the dates out left to right and day headers would repeat them. Alternative: a header per week.
2. **Control** — *Default: a small select in the header ("Project first" / "Date first")*, like the project picker in Notes. Alternative: two toggle buttons.
3. **Default mode** — *Project first*, as today; the owner's choice is remembered in the browser's storage (`done-timeline-group`).

Answered 2026-11-23: the owner asked for this mode switch; decisions 1–3 are defaults shown in chat and **UNCONFIRMED** until the preview.

## Change

- `ui/src/lib/tasks.ts`: `export type TimelineOrder = 'project' | 'date'`. `timelineGroups(projects, tasks, order = 'project')`. `TimelineGroup` gains `key: string` and keeps `id` as the project to mark the header with (`undefined` for a group that is not a project: "Scheduled", "No date").
- `ui/src/components/timeline.tsx`: the select in the header; in date mode each row's title column shows its project dot.
- The stored choice is read with a guard: anything other than `'date'` is project first.

## Tests

- `tasks.test.ts`: date mode puts tasks from different projects in one list in date order, orders a same-day tie by project order (Inbox first) and then priority, and puts undated tasks in "No date"; project mode unchanged (existing test).

## Verification

`npm run typecheck && npm test && npm run build`; local preview on a copy of the owner's tasks, switching modes and dragging a bar in each.

## Out of scope

Grouping by week, more sort options, filtering which projects show.
