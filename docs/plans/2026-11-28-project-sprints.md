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
