# Project sprints

Turn any existing project into a sprint from the project page. The sprint can have a deadline, and completing it hides the project in the sidebar and in the phone's Lists screen. Each menu can show completed sprints so they can be reopened. Tasks, notes, search and direct links stay accessible when a sprint is complete.

Use the existing project change and sync path. A project may include sprint settings `{ enabled, deadline, completed }` in its existing wire representation. Missing settings from an older client leave saved settings intact. Turning sprint mode off explicitly resets its deadline and completion. Deadlines are local calendar days with no time of day and never complete a sprint automatically.

The local demo uses a fresh SQLite file with a regular project, an active sprint, a completed sprint, and a few tasks. Verify conversion, deadline edits, completion, reveal, reopening, refresh and direct links at desktop and phone sizes. Run targeted project persistence and sync checks, then the normal repo tests before release.

## Verification

The frontend typecheck, production build and 821 tests passed. All 123 Rust tests passed across core, MCP and the server with disposable Postgres databases. A legacy-device fixture replays previously read project metadata while preserving pending edits. Desktop browser checks used the local HTTP server and checked persisted Undo, deadline set and clear, complete and reopen, refresh, and tasks staying open. The phone layout revealed a completed sprint from Lists and opened an active sprint by direct link. The sprint feature was previewed in the browser. Packaged native and production acceptance remain outside this local preview.


## Project headers and Timeline

Project maintenance actions use the desktop More menu and the phone's existing action sheet. Filter remains directly available, and completion stays in the sprint panel.

Timeline shows project-coloured spans for scheduled work in both layouts. A span covers the earliest and latest visible scheduled task dates and includes the sprint deadline when set. A sprint with a deadline alone shows a marker on its deadline. Labels connect the chart back to the project. Completed sprints stay folded in project navigation and remain visible on Timeline for historical context.

Verified the More menu hides Rename and Delete until opened, focuses the rename field, and retains the delete confirmation. Desktop and phone browser checks confirmed always-visible project ranges, sprint deadlines and links from the Timeline to the project. The final frontend suite passed all 824 tests.

With grouping on, each span and deadline sit in that project's collapsible header. The separate overview appears in the ungrouped view. Desktop and phone browser checks confirmed one span per project, a header for a sprint with only a deadline, and intact markers when a group is collapsed. All 825 frontend tests passed.

## Completed work on Timeline

Show recent completions by default from Done's existing completed-task history. Use the current workspace and filters. A quiet, unfilled dashed line connects the due date and the date the task was finished. Finishing early extends the line to the left, finishing late extends it to the right, and a task with no due date gets just its completion marker. Keep active tasks interactive. The Timeline options menu can hide completed tasks.

Completed rows were verified for early, late, on-time and undated tasks on desktop and phone. The start-only drag reproduced in the prior build. The same gestures now persist the moved start with no due date. All 826 frontend tests and all 26 touch Timeline checks passed.

## Hide past tasks on Timeline

The Timeline gets crowded with finished history, so its options menu has a second item, "Hide past tasks", off by default and remembered on the device (`done.timeline.past` in localStorage, beside `done.timeline.completed`).

The rule (`ui/src/lib/timeline-past.ts`, `isWhollyPast` and `hidePast`): an open task is never hidden, overdue or not, dated or not. A completed task is hidden when the latest of its start, due and completion days is before today, compared as local calendar days against the app's `TODAY` (the page reloads at midnight). So a task finished early whose due date is today or later stays, and so does anything finished today. A subtask goes or stays with its task; the Timeline draws no subtasks, so this only matters for consistency. Hiding never changes or saves a task.

It runs before anything is counted or drawn, in both the desktop and the touch layout: on the filter's result for the open tasks and for the completed history, then project spans, groups, sprint markers, the axis range and the counts are computed from what is left. Project spans already come from open tasks plus the sprint deadline, so a span never changes; what changes is which project rows exist (`withoutPastProjects`). Ruling: a row goes when nothing of it is left to show, that is every task it had here is hidden, or it is a sprint whose deadline has passed and none of its tasks is shown. A sprint with a deadline ahead, a sprint with a past deadline and an overdue task, and a project that never had tasks here stay as before. Why: an empty group or a past deadline marker would bring back the clutter the option removes. Cost if wrong: a finished sprint's deadline marker disappears while the option is on; turning it off brings it back.

With the filter: the filter applies first, then hiding, so both narrow. With "Show completed" off there is no completed history to hide; open tasks are never hidden, so the option then only removes past sprints with nothing left. While it is on, the filter bar's line under the header shows a "Past hidden" chip with an × that turns it off, and the "x of y tasks" count, whose total is what the chart would hold with nothing hidden; the filter's own chips and Clear sit beside it when a filter is set. With it off the Timeline renders exactly as before.

Verified: the rule's tests (written first and seen failing) cover an overdue open task, completed and due yesterday, completed early with the due date ahead, completed today, a range across today, a start-only open task, subtasks, a completion with no other dates, and the local day boundary. `ui/checks/timeline-hide-past.cjs` (faked API, the built UI) passes 66 expectations at 1440×900, 390×844 touch and 820×1180 touch: the long-ago task's row goes, the overdue open task stays, the count reads 6 of 8, no project group is empty and the Archive group whose only task is hidden is gone, the axis starts a week before the overdue task instead of the hidden one, nothing is synced, the choice survives a reload, and the chip turns it off again. Typecheck, 837 frontend tests and the build passed. Not verified: the packaged Mac and iPhone apps, and real data with many projects.

## Merge with main and older apps

Merged origin/main (88f8341, Apple grant revocation) with no conflicts; auth.rs, auth/ and account deletion are unchanged from main. After the merge: typecheck, 846 frontend tests and the build passed; 131 Rust tests passed (core 50, MCP 13, server 68); `cargo check -p done-app` passed for the Mac and for iOS; timeline-hide-past (66), touch-timeline (26), touch-sizes, routes and filter-views checks passed. board-heights fails one expectation at 844×390 (columns 189 px tall), the same on origin/main.

Older apps (0.1.392 and the App Store iPhone build) drop the unknown `sprint` field when they read a project and send projects without it. The server writes `sprint = coalesce(new, saved)`, so a rename or recolour from an old app keeps the sprint (`a_sprint_round_trips_and_a_legacy_edit_preserves_it` in pg.rs). An old app cannot show, change or clear a sprint. A new app against a server without sprints keeps its sprint on that device only until the server is upgraded and the project is edited again.
