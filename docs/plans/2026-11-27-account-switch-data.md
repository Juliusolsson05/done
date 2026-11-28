# What the device keeps when the account changes

Fixes #106 (switching accounts loses unsent changes) and #107 (shared workspace data stays on the device after sign-out or deletion).

## Outcome

- Signing out tries one last sync. If that fails and changes are still unsent, the person is told and chooses: stay signed in, or sign out anyway.
- A device's file knows which hosted account its synced rows belong to. Those rows are never sent to another account and never dropped without the person being told.
- A row the server refuses is not counted as sent: it goes again next round.
- Signing out or deleting the account removes everything from shared workspaces (tasks, notes, projects, assignees, the member list, invites and notifications). The person's own tasks and notes stay as local data. Widgets and the focus timer show only what is left.
- Editing a task with no project no longer clears its space on the device.

## Evidence (audit, re-run on origin/main eea3210)

`F1_F2_F3.patch` adds three tests to `crates/server/src/pg.rs`. All three fail on main:

- F1: after B's first round the phone has only `Inbox thing EDITED OFFLINE`; outbox 0 tasks; Julius's account has the old titles; Geart's is empty. `the offline edit of a Home task exists nowhere`.
- F3: `unsent rows left: 0`, the phone row's `space_id` is `None`. `the edit is on the phone only, and nothing will send it again`.
- F2: after `delete_account(geart)` the phone still holds `Julius's private-to-Hop task` and the team JSON with both members' names and emails.

Causes, read in the code:

- `ui/src/lib/backend.ts` `signOut`/`deleteAccount` forget the token and reload; nothing in core runs and no round is tried.
- The device sends whatever has `seq > pushed` to whichever account is signed in. The server skips rows in a space the writer is not in (`pg.rs` `merge`, `continue`), `inbox` sets `pushed = upto` anyway, and `take_spaces` deletes every row whose space the new account does not list, without a tombstone.
- `crates/core/src/lib.rs` `sync`: the task upsert sets `space_id` from the project, or the parent; for a task with neither it is NULL, replacing the space the server gave it.
- After the reload, `state()` returns the workspace rows and `kv 'team'`; `App.tsx` builds the widget snapshot from them again.

## Decisions

1. **The file is bound to one account.** `kv 'account'` holds `{id, email}` of the account the file last synced with, written by every successful round (`inbox_for`). A file from an older version has no such key; its `kv 'team'` (`me`, and the email from the personal space's members) stands in, so devices already out there are covered too.
2. **A round for another account is held, not sent.** `outbox_for(account, take_over)`: when the file is bound to a different account and holds rows or unsent deletions, it returns `held: {account, rows, unsent}` and no rows. The app sends nothing and asks:
   - unsent > 0: "N changes from a@x were never sent. Sign in as a@x to send them, or remove them from this device." [Sign out] [Remove them]
   - unsent = 0: "This device has tasks from a@x. They are in that account." [Sign out] [Continue]
   Choosing Remove/Continue calls `outbox_for(account, true)`, which empties the file (rows, tombstones, team, cursors, binding) and syncs as a first sign-in. `inbox_for` refuses a reply for an account the file is not bound to, so nothing from B is merged into A's file by a race.
   Why this one: it is the simplest rule that guarantees no row disappears without the person being told. The alternative, sending A's unsent work to B where "safe", needs the device to tell new rows from edits of rows A's server has, which it cannot (a task added after sign-out takes the project's space, A's). The server stays the only one deciding spaces; nothing here sends a `spaceId` for an existing row.
3. **Leaving** (`leave_account(deleted)`, one transaction):
   - Both: delete every task, note and project whose space is set and is not the personal space in `kv 'team'`, every assignee row, `kv 'team'` (members, invites, notifications) and the space cursors. No tombstones: nothing was deleted, this device just no longer holds it.
   - Sign-out: the personal rows stay bound to the account (the binding is written now if it was only in `team`), with their unsent changes, so signing in again as the same account sends them.
   - Account deleted: the binding goes, the personal rows lose their space, tombstones go, and every row counts as unsent (`pushed = 0`, `seq >= 1`): plain local data, as on a device that never signed in. A later sign-in sends it up like any first sign-in. The account and its server data are gone, so there is nothing of it left to send it to by mistake.
   - Also run on every load of an app window that is not signed in, as a safety net: a session ended by the server (401), a sign-out on an older version, or a failed call. When there is nothing to remove it changes nothing (no new revision).
4. **Before signing out**: one round; if it fails, count what is unsent (`outbox_for`); if any, the Settings button asks: "N changes are not sent yet. Your own stay on this device and go up when you sign in again. Changes in shared workspaces are lost." [Sign out anyway] [Stay signed in]. When Apple ends the credential the app signs out at once, without a round or a question (the person cut done off).
5. **Refused rows go again.** The server's reply gains `refused: [{kind, id}]` for projects, tasks, notes and entries it skipped because the row is in, or points into, a space the writer is not in. The device gives each one still in the file after `take_spaces` a new `seq`, so it is unsent again, sent next round, and counted by the sign-out question. Ties and older edits are not listed (the server has the newer row; nothing is lost).
6. **Side bug**: the task upsert keeps the task's existing space when it has no project or parent (`coalesce(excluded.space_id, task.space_id)`), as the server does ("else where it already is").
7. **Widgets and the focus timer**: the window reloads after leaving and builds the widget snapshot from what is left, so workspace tasks are gone from it. A focus session on a workspace task is ended before leaving (its time goes to the person's own time sheet, as on Stop), so the Dynamic Island and the menu bar no longer carry that title.

Ruling: time sheet entries are kept on sign-out — the server keeps them in the personal space only (`pg.rs`: "The time sheet is always one's own"), so none belongs to a workspace — cost if wrong: an entry's title may name a workspace task the person worked on; it stays in their own time sheet.

Ruling: refused deletions (tombstones) and assignees are not reported — a deletion of a row in a space one has left would be retried forever and keep the sign-out question asking — cost if wrong: such a deletion is dropped as before, and the row is gone from this device anyway.

Ruling: a 401 is treated as a sign-out, not a deletion — the device cannot tell an account deleted on another device from a session ended — cost if wrong: after the account was deleted elsewhere, its personal rows stay bound to it; a later sign-in as someone else is held with "They are in that account", which is no longer true, and Continue removes them.

## Compatibility

- Older app, new server: `refused` is a new field the old app's `Reply` ignores (serde ignores unknown fields; no `deny_unknown_fields`). Nothing else the server sends changes.
- New app, current server: no `refused` comes back, so refused rows are counted as sent, as today. Binding, holding and leaving are all on the device; the current server already sends `team.me`.
- `held` is never sent to the server (the app sends nothing when it is set, and it is skipped when empty).
- No new tables or columns in the device's SQLite file: the binding is a row in `kv`. Each new core call is one `BEGIN IMMEDIATE` transaction, so an interrupted one leaves the file as it was.
- Merging with #101: both add a command to the one `generate_handler!` line in `crates/app/src/lib.rs` (`leave_account` here, `web_sign_in` there). #101 merged first; this branch is rebased on it with both names kept. Nothing else overlapped; `signIn` is untouched.

## Tests

- `crates/server/src/pg.rs` (the audit's tests, reshaped to assert the right behaviour):
  - F1: sign out of Julius, sign in as Geart: held with 3 unsent, nothing sent, all three titles still on the phone; Julius signs back in and all three reach his account; or Geart takes over and his account has none of Julius's rows.
  - F3: a row the server refuses stays unsent and reaches the right account later.
  - F2: after sign-out, and after deletion, the phone has no Hop rows, no assignees, no team; the person's own task is still there.
- `crates/core`: binding and holding, leave keeps personal rows, deleted leaves plain local data that goes up whole to a new account, refused rows get a new seq, the Inbox edit keeps its space, leaving twice is a no-op.
- `ui/src/lib`: counting unsent rows, the held message, which focus session must end.

## Verified / not verified

Verified (27 Nov, on this branch):

- The audit's three tests fail on origin/main (eea3210) for the stated reasons (output in the PR).
- The reshaped tests fail with the fix switched off (holding, leaving, the refused re-send and the Inbox space fix disabled in core) and pass with it. `a_refused_row_is_sent_again` (core) fails with only the re-send switched off.
- `cargo test -p done-core -p done-mcp -p done-server`: 40, 13 and 49 passed. `cargo check -p done-app` and `cargo check -p done-app --target aarch64-apple-ios` pass.
- `npm run typecheck`, `npm test` (668 passed after rebasing on main with #101, #103 and #105), `npm run build` pass. `note-list.test.ts` failed once in a full run and passed alone and on the next full run; it does not touch anything changed here.

Not verified:

- A real iPhone, iPad or Mac app run: the Settings question, the held dialog, signing out and deleting on a device.
- The widgets and the Live Activity on a device. Read, not run: after leaving the window reloads, and `App.tsx` builds the snapshot from what `state()` returns, which no longer has workspace rows; a focus session on a workspace task is ended first.
- Two windows of the Mac app open while signing out (each reloads; the second loads after the file was cleaned).

Privacy of `refused`: it only names ids the writer sent itself. Whether such an id exists elsewhere could already be told from the reply (a row that did not exist comes back placed in the writer's space; one that did, does not).
