# Every device keeps its own tasks and syncs with the account

Owner, 21 Nov 2026: "keep local support and syncing with cloud often so that it makes sense", and "now i just signed in to the web app and it is empty, when i now sign in with same account to local app that should work".

## Outcome

- The Mac and iPhone apps always work on their own file, with or without a connection.
- Signed in, the app swaps changes with the account at thedone.app: when it opens, when it comes back to the front, when the connection returns, every 15 seconds while in view, and 1.5 seconds after an edit.
- The first sign-in sends everything on the device to the account. The web app then shows it.
- Signing out keeps everything on the device.

Before this change, signing in switched the app to the hosted server with no local copy (decision D7 in the private ledger). That is replaced.

## Design (crates/core/src/replica.rs)

- Each of the four tables that travel (project, task, note, entry) has `changed` (ms, time of the last edit) and `seq` (this file's own counter at its last write).
- Triggers keep these up to date, so every writer is counted without remembering to: the app, the MCP server and the web app.
- A deleted row leaves a tombstone `(kind, id, changed, seq)`.
- Device: `outbox()` returns rows with `seq > pushed` plus `pulled`. `inbox(reply, upto)` merges the server's rows without counting them (`quiet`), then sets `pushed = upto` and `pulled = reply.upto`.
- Server: `exchange(outbox)` merges the device's rows (counted, so other devices fetch them). It answers with rows whose `seq > outbox.pulled`. `POST /api/replicate`, bearer token, cloud mode only. A round with nothing new only reads, so the stored file is not rewritten.
- The later edit wins, row by row. Ties keep what is there, so an echo is never written twice.
- After a merge, rows that no longer fit are repaired:
  - a task or note in a project that no longer exists goes to no project;
  - a subtask whose task is gone becomes a task;
  - nesting goes one level only;
  - each day has one goal.
- Ids come from the clock: ms × 1000 plus a random part below 1000. They are unique across devices and still sort in the order rows were added. This matters because subtasks are listed by id.
- Rows with ids below 2^32 (counted up from 1 on each device) are renumbered once before they are first sent. Their order is kept and every reference is moved with them.

## Rulings

- Ruling: the network round is made by the window, not by Rust. The window already holds the token, and the app needs no HTTP client. Cost if wrong: no sync while the window is closed. On the Mac the window is hidden rather than closed, so sync runs on focus.
- Ruling: last edit wins per row, not per field. Cost if wrong: two people editing different fields of one task on two offline devices keep only one edit. Acceptable for one person's list.
- Ruling: a round is queued with the saves in `store.ts`, so it never runs mid-save. A reload never overwrites an edit that has not been saved.

## Tests

- core:
  - two devices each add "task 1" and both survive;
  - nothing new means nothing sent;
  - the later edit wins and a deletion travels;
  - notes and the time sheet travel;
  - a task in a project deleted elsewhere falls back to the Inbox;
  - an edit made while a round is out is sent next time.
- core, on a copy of the owner's real file (`DONE_SYNC_COPY`, run by hand): 7 projects, 166 tasks, 3 notes and 2 entries go up and come down identical on a new device. Nothing is sent a second time.
- server: a device swaps changes, and the web app shows them. Without a token the call is 401.

## Verification boundary

- Not verified here: a round trip from the released Mac app against thedone.app, and the iPhone app on a device. Both follow the release.
