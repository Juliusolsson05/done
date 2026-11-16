# Focus: queue the next blocks and keep a daily time sheet

Fixes #9.
Branch `feat/focus-time-sheet` · Worktree `../done-wt/focus-time-sheet` · Base `origin/main` @ 844f36a (2026-11-16)
Status: implemented; the owner looked at the local build and approved merging and releasing it on 2026-11-16.

## Outcome

In Focus, a button in the corner opens **Up next**: the blocks to do after this one, each a task (or nothing in particular) and an estimate in minutes. When a block's time is up, the first one is offered as one button, beside +5 / +10 / +15 minutes. Every block that ends is written down, and a new **Time sheet** page shows a day's blocks: when, what, planned, how long it really took, and the difference.

## Evidence (verified, do not re-derive)

- The session lives in `ui/src/lib/focus.ts` (pure logic) and `ui/src/lib/focus-store.ts` (localStorage `done-focus`, hand-off to the menu bar). Time focused is already `total - timeLeft`; `extend()` only adds to `total`, so pauses and reminder breaks are excluded and extensions are included. There is no record of the original length: `total` changes on extend.
- Sessions end in four places: `endFocus()` (Stop, Close, menu bar Stop, Finish task via `Running.finishTask`), all through `focus-store`.
- `crates/core` is the only code touching SQLite; windows save through `sync(Change)` with one revision for the whole file, refused as `Stale` when another writer saved first. Task ids are handed out by the window and saved a moment later.
- `crates/core/src/lib.rs` is unchanged since the first version; the desktop app (`crates/app/src/main.rs`) and web app (`crates/server/src/main.rs`) each expose `state` and `sync`.
- The focus-timer plan (`2026-11-14-focus-timer.md`) listed "a planned sequence of work blocks" and "time recorded per task" as not in that version.
- No popover component exists in `ui/src/components/ui/`; `sheet.tsx` (a side panel) does.

## Decisions

1. **Time sheet storage** — *SQLite, a new `entry` table in core*, so the desktop app and the web app share one history that survives cleared browser storage. Alternative: browser storage.
2. **Up next storage** — *browser storage, beside the session*: it is today's plan in one window, like the session.
3. **When a block ends** — *offer the next one with one button; never start it on its own.*
4. **Extending** — *+5, +10, +15 at the end*, replacing the single "10 more minutes". Extensions count toward actual time, not planned.
5. **What is recorded** — *every block that ends* (time up then closed, Finish task, Stop, Start next); under one minute focused is not recorded.
6. **Where Up next is reached** — *a corner button in Focus, both while setting up and while running.*
7. **Time sheet page** — *sidebar item and key 7, one day at a time with arrows, rows deletable, not editable.*
8. **Not in this version** — editing entries, the time sheet over MCP, an estimate stored on the task.

Answered 2026-11-16: the owner said to build it and show it locally before merging, without changing a decision. All eight shipped as the defaults; the owner looked at the local build and approved it as it is.

Ruling: entries carry no foreign key to `task` — a block on a task added seconds ago may be recorded before that task's save lands, and a foreign key would refuse it; the entry stores the title it had, so a deleted task's rows still read correctly, and undoing a delete re-links them because the id is kept — cost if wrong: an entry may name a task id that no longer exists, which the page already handles by showing the stored title.

Ruling: entries are written through their own `record_entry` call, not through `sync(Change)` — they are only ever added, so there is nothing to conflict over, and a block's end must never be lost because another window saved first — cost if wrong: deleting an entry from two windows at once deletes it once, which is the wanted result anyway.

## Design

### Core (`crates/core/src/lib.rs`)

- `Entry { id, task_id: Option<i64>, title, day, started_at: i64, ended_at: i64, planned_ms: i64, focused_ms: i64 }` (camelCase over JSON). Times are milliseconds since 1970: a block is a span of real time, unlike a task's due day.
- `NewEntry` — the same without `id`.
- Table `entry` created in `Store::open` with `CREATE TABLE IF NOT EXISTS`, so an existing tasks file gains it without a migration step. Index on `day`.
- `Store::record(NewEntry) -> Result<Entry, Error>` — checks: title not blank, `day` is a day, `ended_at >= started_at`, `planned_ms >= 0`, `focused_ms >= 0`. Does not touch `rev`.
- `Store::entries(day) -> Result<Vec<Entry>, Error>` — ordered by `started_at`.
- `Store::delete_entry(id) -> Result<(), Error>`.

### Desktop app and web app

- Tauri commands `entries(day)`, `record_entry(entry)`, `delete_entry(id)`.
- Web: `GET /api/entries?day=`, `POST /api/entries` (JSON `NewEntry`), `POST /api/entries/delete` (JSON `{ id }`). Both writes are JSON-only, keeping the same cross-site boundary as `/api/sync`.

### Interface

- `ui/src/lib/focus.ts`
  - `Session` gains `startedAt: number` and `planned: number` (ms). `extend()` leaves `planned` alone. A stored session without them gets `planned = total`, `startedAt = endsAt - total` (or now).
  - `focused(session, now)`.
  - `entryOf(session, now): NewEntry | null` — null under one minute focused; `day` is the local day the block started; `endedAt` is when time ran out for an ended session, else `now`.
  - `Block { id, taskId: number | null, title, minutes }`; `newBlock(id, task | null, minutes)` (null without a valid length, 1–600), `moveBlock(blocks, id, by)`.
  - `startBlock(block, tasks, now, reminders)` — a session for the block; its task is dropped if it has since been finished or deleted, keeping the title.
- `ui/src/lib/time-sheet.ts` — `Entry`/`NewEntry` types, `sheetRows(entries)` (difference per row), `sheetTotals(entries)`, `minutesText(ms)`.
- `ui/src/lib/backend.ts` — `loadEntries(day)`, `recordEntry(entry)`, `deleteEntry(id)`.
- `ui/src/lib/focus-store.ts` — the Up next list (`done-up-next` in localStorage): `getUpNext`, `queueBlock`, `unqueueBlock`, `moveQueued`. `endFocus()` records the ending block before clearing. `startNext()` records the current block (if any) and starts the first queued block, removing it. `onRecorded(handler)` / `onRecordFailed(handler)` so the Time sheet redraws and a failed write is said.
- `ui/src/components/up-next.tsx` — the corner button (with a count) and a side sheet: the list with up/down/remove, and a row to add a task and minutes.
- `ui/src/components/focus-view.tsx` — the corner button in the header; the ended screen offers "Start next: <title> · <n> min", +5/+10/+15, Finish task, Close; the setup screen offers "Start next" too when the list is not empty.
- `ui/src/components/time-sheet.tsx` — the page: day with arrows and "Today", rows (time range, title, planned, took, difference), totals, delete per row.
- `ui/src/lib/tasks.ts`, `App.tsx`, `app-sidebar.tsx` — view kind `timesheet`, sidebar item, key 7, quick add from it goes to Inbox.

### Invariants

- Planned is the length a block started with; only actual time grows when extended.
- Actual time excludes pauses and reminder breaks (it is `total - timeLeft`).
- Recording a block never depends on the tasks file's revision.
- A block is recorded once: the session is cleared in the same step that records it.

## Files

- Modify `crates/core/src/lib.rs` — entry table, record/entries/delete, tests.
- Modify `crates/app/src/main.rs`, `crates/server/src/main.rs` — expose them.
- Modify `ui/src/lib/focus.ts`, `focus-store.ts`, `backend.ts`, `tasks.ts`, `app-context.ts`; `ui/src/App.tsx`; `ui/src/components/focus-view.tsx`, `app-sidebar.tsx`.
- Create `ui/src/lib/time-sheet.ts`, `ui/src/components/up-next.tsx`, `ui/src/components/time-sheet.tsx`.
- Tests in `ui/src/lib/focus.test.ts`, `ui/src/lib/time-sheet.test.ts`, and core's test module.

## Tests

- Core: a recorded entry comes back for its day and not another; recording is not refused when the revision has moved on (the reason for its own call); an entry outlives its task's deletion with its title; a bad entry (blank title, end before start) is refused; deleting removes it.
- Interface logic: planned stays and actual grows when a block is extended; a paused stretch and a reminder break do not count as actual time; under a minute is not recorded; an ended block's end is when time ran out, not when it was closed; a queued block whose task was finished starts with its title and no task; moving a block in the list; totals and differences.

## Verification

- `npm run typecheck && npm test && npm run build` in `ui/`; `cargo test -p done-core -p done-mcp -p done-server`.
- Run the web app locally against a copy of the owner's tasks file (`DONE_DB`), and go through: queue two blocks, run a short block to its end, extend, start next, stop early, open the Time sheet.
- **Verification boundary:** the desktop app and its menu bar are not rebuilt here (a Tauri build needs several GB of disk and this Mac had 16 GB free). The menu bar code is not changed; the new Tauri commands are three one-line wrappers, checked by `cargo check -p done-app` only if disk allows, otherwise reported as unchecked.

## Out of scope

Editing entries; the time sheet over MCP; an estimate stored on the task; a week view.

## Execution notes

- Plan vs built: Core, desktop and web app, Interface and Invariants MATCH. Two DRIFTs, both found in the local preview and fixed: the Up next task picker is held to its panel's width (`position="popper"`), and the time sheet's title column takes the free width.
- Ruling: the shortcut keys (q, 1–7, Space) are ignored inside any `[role="dialog"]`, so Space on a button in the Up next panel presses that button instead of pausing the timer behind it — cost if wrong: a shortcut no longer works from inside the task editor dialog, where every field already swallowed it.
- Verified: `npm run typecheck`, 387 interface tests, `cargo test -p done-core -p done-mcp -p done-server` (13), the two new focus tests proven by reverting `endedAt` and the finished-task check. Local web app run against a copy of the owner's tasks file: queue, reorder, end-of-block screen, Start next, a sub-minute Stop not recorded, an early Stop recorded as −2 min, rows surviving a server restart.
- Not run here: the packaged desktop app and its menu bar; the nightly release builds it.
