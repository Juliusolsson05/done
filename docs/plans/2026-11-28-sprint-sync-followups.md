# Sprint sync follow-ups

Review follow-ups for project sprints (#133, merged as b3e392e). Issue #134.

## 1. An older app on the same file brings back an old sprint

An older app (one that does not know `sprint`: Mac 0.1.392, a downgrade, or "done next" beside the real app) can open a file the new app already upgraded. Its `prepare` rewrites the triggers without `sprint`, it pulls rows from the server, keeps whatever sprint the file had (it never touches the column) and moves the sync position past them. The new app reopens, the column exists, so nothing is fetched again, and its next edit of that project sends the old sprint with a newer stamp. Reproduced: the phone completed the sprint, the Mac renamed, the phone ended with completed: false.

Decision: in `Store::open`, before the triggers are rewritten, the new app looks at `project_edited`. If it exists and its SQL lacks `sprint`, an older app has opened the file since. In one IMMEDIATE transaction (the pattern `prepare_project_sprints` already uses, so two processes do not both do it):
- reset the sync positions (`space_cursor.pulled`, `meta.pulled`) to 0, so everything is fetched again;
- clear the sprint of every project row the server already has (`seq <= pushed`), quietly (no seq or stamp change), so the value the file has is not trusted. The re-download then fills it from the server through the existing tie rule (same stamp, local sprint NULL). Until then a rename sends no sprint, and the server keeps its own (`coalesce`), and echoes it back.

Why clearing as well as re-downloading: the old app stored the phone's row with the phone's stamp but the file's old sprint. On re-download that row ties, and a tie keeps what is here, so a reset alone does not repair it. And the user may rename before the first sync, which a reset alone cannot stop.

It cannot loop: `prepare` then rewrites the trigger with `sprint`, so the next open by a new app sees it and does nothing. Only an older app opening the file again sets it off again.

Cost: one full re-download per new-app open that follows an older app's open, and sprints on that device are hidden until that re-download (offline: until it is online). Rows not yet sent (`seq > pushed`) keep their sprint: they may be the user's own edit the server has never seen. Ruling: never discard a value the server does not have — why: losing an unsent edit is worse than the rare stale one — cost if wrong: an older app that renamed a project offline and quit before syncing can still send an old sprint once.

Not fixed: an older app and the new app running at the same time on one file. The check runs at open; while both run, the trigger is the older app's. Rare (only the preview beside the real app); noted, not built.

## 2. A newer row without a sprint keeps the local one

The device-side merge writes `sprint = coalesce(excluded.sprint, sprint)`. No test covered it. Add one: a newer incoming row with no sprint, the local row with one, the local one stays and the name changes.

## 3. Cross-device round trip

Commit the reviewer's probe as a server test: set, change the deadline, complete, clear the deadline, turn off, turn back on; after each step the server and a second device agree, with an old-style rename (no `sprint` key) in between that keeps the sprint.

## 4. A new app against a server without the sprint column

The sprint is dropped silently and the row counts as sent. Production runs the new server, so no machinery. One core test documents it (an older server is a Store whose project table has no `sprint` column, if cheap).

## 5. Agents see sprints

`list_projects` adds `sprint: { deadline, completed }` for a project that is a sprint; no tool's inputs change. One sentence in the MCP instructions.

## 6. Timeline start edge of a start-only task

`dragBar(task, 'start', n)` on a task with a start and no due date returns it unchanged. The smaller change is in `dragBar`: dragging the start of a start-only task moves its start, as moving it does. A test beside it.

## Verification

To be filled in as the work lands.
