# Sprint sync follow-ups

Review follow-ups for project sprints (#133, merged as b3e392e). Issue #134.

## 1. An older app on the same file brings back an old sprint

An older app (one that does not know `sprint`: Mac 0.1.392, a downgrade, or "done next" beside the real app) can open a file the new app already upgraded. Its `prepare` rewrites the triggers without `sprint`, it pulls rows from the server, keeps whatever sprint the file had (it never touches the column) and moves the sync position past them. The new app reopens, the column exists, so nothing is fetched again, and its next edit of that project sends the old sprint with a newer stamp. Reproduced: the phone completed the sprint, the Mac renamed, the phone ended with completed: false.

Review reproduced two regressions using v0.1.392 against a disposable SQLite file. Two server refusals can move the push checkpoint past a project the server does not have. An older app can also acknowledge a newer app's offline sprint edit without sending its sprint. Clearing based on the push checkpoint erases the local value in both cases.

The recovery has three stages. First, reset the pull checkpoints and mark sprint values on rows last written by a pull (`seq = 0`) as needing confirmation. This is the provenance available on existing files, and the stored sprint remains visible offline. Second, omit those unconfirmed values from outgoing edits until the server sends a sprint. An actual sprint edit establishes a local value immediately and travels normally. Third, accept an authoritative sprint on replay even when the row stamp ties. A reply without a sprint leaves the cached value alone. When the account is deleted and the retained projects become local, their sprint values can travel again as part of a future account.

Ruling: keep the sprint value on disk and recover rows last written by a pull. The row checkpoint acknowledges a project, while only an actual sprint value in a reply confirms that field. Existing files lack field-level history once an old app has written a local project edit over its pull. Automatically replacing those ambiguous rows could erase unsent work. That case, including a legacy offline rename between the pull and reopen and resending a previously acknowledged offline sprint without a new edit, still needs field-level history. Concurrent operation of the two versions on one file also remains outside the recovery.

Verification fixtures are the reported old-app pull then new-app rename, and the two sequences recorded during review. Automation uses the real SQLite entry points and the old wire shape. Replay tests also cover an explicit newer sprint edit and a server reply with no sprint. The review probe compiles the v0.1.392 core and the current core against disposable files.

## 2. A newer row without a sprint keeps the local one

The device-side merge writes `sprint = coalesce(excluded.sprint, sprint)`. No test covered it. Add one: a newer incoming row with no sprint, the local row with one, the local one stays and the name changes.

## 3. Cross-device round trip

Commit the reviewer's probe as a server test: set, change the deadline, complete, clear the deadline, turn off, turn back on; after each step the server and a second device agree, with an old-style rename (no `sprint` key) in between that keeps the sprint.

## 4. A new app against a server without the sprint column

The sprint is dropped silently and the row counts as sent. Production runs the new server, so no machinery. Ruling: no test — why: an older server is a different binary (pg.rs at an older commit), and a core `Store` without the column cannot stand in for it without rewriting its merge — cost if wrong: none while every server has the column; a sprint set against an older server stays on that device until the project is next edited after the upgrade (as the sprints plan already says).

## 5. Agents see sprints

`list_projects` adds `sprint: { deadline, completed }` for a project that is a sprint; no tool's inputs change. One sentence in the MCP instructions.

## 6. Timeline start edge of a start-only task

`dragBar(task, 'start', n)` on a task with a start and no due date returns it unchanged. The smaller change is in `dragBar`: dragging the start of a start-only task moves its start, as moving it does. A test beside it. Found while checking: neither Timeline draws a start grip on a one-day bar (`range` is false), so a press on a start-only bar's left edge already moves the bar, which is moving its start; the change makes the rule complete rather than changing what a person sees.

## 7. "The bars above the tasks are long, 10 days too long?"

Reported by the owner on the live web app. Reproduced with a faked API on the built UI (b3e392e plus this branch, which does not touch the Timeline), at 1440×900 and 390×844 touch, at week, month and quarter zoom, grouped and not. Seed: an ordinary project with tasks on days +2..+4, +4..+6 and a start-only task on +3, plus a subtask due +20, an undated task and a completed task due +16; and a sprint with one task on +3..+5 and its deadline on +12.

Measured: the ordinary project's bar matched its first and last task bars within 2 px at every size and zoom (desktop week 736–936 against 738–934; phone week 169–424 against 171–422). Subtasks, completed, undated and start-only tasks did not stretch it. The sprint's bar ran from its task to the deadline, 7 days past its task (desktop week 776–1176 against the task's 778–894). Not reproduced for an ordinary project.

The rule, as the sprints plan says it ("a span covers the earliest and latest visible scheduled task dates and includes the sprint deadline when set"): from the earliest start (or due) to the latest due among the project's visible open tasks, stretched to the sprint deadline in either direction while sprint mode is on, completed or not. The coordinator's proposed rule differs in two ways: only a later deadline and only an active sprint stretch it. The plan was followed; no code changed. Most likely what the owner sees is a sprint whose deadline is about ten days after its last task: the bar runs on to the diamond on the deadline. Not verified against the owner's data (it is on the hosted server and is not read from here).

Guards added: a unit test that a project with tasks 1–5 December gets exactly those days, with a subtask, a completed and an undated task beside them; and an assertion in `ui/checks/timeline-hide-past.cjs` that the Website bar's edges match its task's bar within 2 px at all three sizes. Screenshots in the session scratchpad, `timeline-span/`.

## Verification

Fail first: `an_older_app_on_the_same_file_cannot_bring_back_an_old_sprint` failed on b3e392e with "cloud: the phone's completion survives", left completed: false; it passes with the fix. `a_newer_row_without_a_sprint_keeps_the_local_one` passes on b3e392e (it covers code that was right) and failed with the reviewer's mutation (`sprint = excluded.sprint`): left None. The `list_projects` assertion failed without the change (Null). The `dragBar` start-only case failed on b3e392e (start unchanged). The cross-device round trip in pg.rs is coverage and passes on b3e392e too.

Suites: typecheck, 847 frontend tests and the build; 134 Rust tests (core 52, MCP 13, server 69) with a throwaway Postgres; `cargo check -p done-app` for the Mac and `--target aarch64-apple-ios`; `timeline-hide-past.cjs` 69 expectations.

Review follow-up verification: the two new protection tests failed on the original recovery with a missing local sprint and pass with the revised recovery. An isolated probe using the actual v0.1.392 core and the revised current core confirmed three cases: an old pull followed by a current rename preserves the cloud sprint, a twice-refused local sprint survives reopen, and an offline completion omitted by the old sync survives the replay locally.

Not verified: concurrent operation of both versions, or the packaged apps.
