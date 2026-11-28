# What the device keeps when the account changes

Fixes #106 (switching accounts loses unsent changes) and #107 (shared workspace data stays on the device after sign-out or deletion).

## Outcome

- Signing out tries one last sync. If that fails and changes are still unsent, the person is told and chooses: stay signed in, or sign out anyway.
- A device's file knows which hosted account its synced rows belong to. Those rows are never sent to another account and never dropped without the person being told.
- A row the server refuses is not counted as sent: it goes once more. Refused again, it stays on this device as local data, no longer sent or counted.
- A session that ends (a 401) keeps every unsent change, and the person is told and offered to sign in. A window that loads signed out changes nothing unless leaving was marked for this file.
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

1. **The file is bound to one account.** `kv 'account'` holds `{id, email, personal}` of the account the file last synced with, written by every successful round (`inbox_for`). `personal` (its own space) is kept here because leaving removes the team. A file from an older version has no such key; its `kv 'team'` (`me`, and the email from the personal space's members) stands in, so devices already out there are covered too.
2. **A round for another account is held, not sent.** `outbox_for(account)`: when the file is bound to a different account and holds rows or unsent deletions, it returns `held: {account, rows, unsent}` and no rows. The app sends nothing and asks:
   - unsent > 0: "N changes from a@x were never sent. Sign in as a@x to send them, or remove them from this device." [Sign out] [Remove them]
   - unsent = 0: "This device has tasks from a@x that were synced with that account. Take them off this device to use this account here?" [Sign out] [Continue] (not "they are in that account": it may have been deleted since).
   Choosing Remove/Continue calls `take_over(account)`, which empties the file (rows, tombstones, team, cursors, marks) and binds it to the new account in one transaction, before any round; then the window loads the file again and closes the dialog whatever the round after it does (review of #112, 4). "Sign out" there is a session that ended for the file's account (below): its unsent changes stay. `inbox_for` refuses a reply for an account the file is not bound to, so nothing from B is merged into A's file by a race.
   Why this one: it is the simplest rule that guarantees no row disappears without the person being told. The alternative, sending A's unsent work to B where "safe", needs the device to tell new rows from edits of rows A's server has, which it cannot (a task added after sign-out takes the project's space, A's). The server stays the only one deciding spaces; nothing here sends a `spaceId` for an existing row.
3. **Leaving is marked, then done.** `mark_leaving(how)` writes `kv 'leaving'` into the file before the session is forgotten or the server asked to delete; `finish_leaving()` does it and takes the mark away in one transaction. A weaker mark never replaces a stronger one (`ended` < `signed-out` < `deleted`). A window that loads signed out runs `finish_leaving()` once, which with no mark does nothing: the "done next" preview app is never signed in and runs on the real file, and must not change it (review of #112, 1). A round that is answered (`inbox_for`) takes any mark away: the account is there.
   - All three: every assignee row of what goes, `kv 'team'` (members, invites, notifications) and the space cursors go. No tombstones: nothing was deleted, this device just no longer holds it.
   - `ended` (a 401: tokens last 30 days; Apple ending the credential; "Sign out" in the held dialog): only workspace rows already sent (`seq <= pushed`) go. Unsent ones stay, with a task they are a subtask of and the project they are in, bound to the account; the held check keeps them from anyone else, and they go up when it signs in again. Nobody chose to drop them.
   - `signed-out` (the person signed out, told of anything unsent): every workspace row goes. The personal rows stay bound to the account (the binding is written now if it was only in `team`), with their unsent changes.
   - `deleted`: as `signed-out`, then the binding goes, the personal rows lose their space, tombstones go, and every row counts as unsent (`pushed = 0`, `seq >= 1`): plain local data, as on a device that never signed in. Marked before the deletion is posted, so a round answered 401 once the account is gone (which reloads at once) still ends in this, not in `ended` (review of #112, 5). A refusal by the server takes the mark back.
4. **Before signing out, and before deleting**: syncing stops and the round in flight is waited for before anything is cleaned (review of #112, 6). Signing out first tries one round; if changes are still unsent, the Settings button asks: "N changes not sent yet. Sign out anyway? Your own stay on this device and go up when you sign in again. Changes in shared workspaces are lost." [Sign out anyway] [Stay signed in]. Asking to delete tries one round too, and the confirmation adds "N changes not sent yet. Your own stay on this device; changes in shared workspaces are lost." when some are (review of #112, 7).
   - After a 401 the window says "Your session ended. N changes are waiting on this device. Sign in to send them." with a Sign in button (to Settings), and Settings says "N changes from a@x are waiting on this device. Sign in as a@x to send them." for as long as they wait.
5. **Refused rows go again, once.** The server's reply gains `refused: [{kind, id}]` for projects, tasks, notes and entries it skipped because the row is in, or points into, a space the writer is not in. The device gives each one still in the file after `take_spaces` a new `seq`, so it is sent once more, and remembers it (`kv 'refused'`). Refused a second time in a row, it is no longer sent nor counted, and its space is cleared, so it stays in the list on this device as its own; an edit of it later tries once more (review of #112, 3). Ties and older edits are not listed (the server has the newer row; nothing is lost).
5b. **An account made again** (deleted elsewhere, then the same Google or Apple login again: same id, a new personal space). `inbox_for` sees the bound account's personal space change, and makes the rows in the old one this device's own again (no space, unsent, the time sheet too) before `take_spaces`, which would have dropped them as a space one left. They go up to the new space next round (review of #112, 2).
6. **Side bug**: the task upsert keeps the task's existing space when it has no project or parent (`coalesce(excluded.space_id, task.space_id)`), as the server does ("else where it already is").
7. **Widgets and the focus timer**: the window reloads after leaving and builds the widget snapshot from what is left, so workspace tasks are gone from it. A focus session on a workspace task is ended before leaving (its time goes to the person's own time sheet, as on Stop), so the Dynamic Island and the menu bar no longer carry that title.

Ruling: time sheet entries are kept on sign-out — the server keeps them in the personal space only (`pg.rs`: "The time sheet is always one's own"), so none belongs to a workspace — cost if wrong: an entry's title may name a workspace task the person worked on; it stays in their own time sheet.

Ruling: refused deletions (tombstones) and assignees are not reported — a deletion of a row in a space one has left would be retried forever and keep the sign-out question asking — cost if wrong: such a deletion is dropped as before, and the row is gone from this device anyway.

Ruling: a 401 is a session that ended, not a sign-out and not a deletion — the device cannot tell an account deleted on another device from a token that ran out, and nobody chose anything — cost if wrong: after the account was deleted elsewhere, its personal rows and unsent workspace edits stay bound to it. Signing in again with the same login is the account made again (5b): the personal rows go up to the new space; unsent edits to workspaces it is no longer in are refused twice and stay on the device as local rows. Signing in as someone else is held ("synced with that account"), and only the person's Remove/Continue takes those rows off; until then nothing is lost.

Ruling: a refused row stays on the device out of sync after its second refusal — re-sending for ever kept the sign-out question asking about changes that can never go — cost if wrong: an edit the server would take later (after an invite, say) stays on this device only until the row is edited again.

Ruling: a 401 during "Delete my account" keeps the deletion mark — the account may already be gone — cost if wrong: an expired session that never deleted anything is cleaned up as a deletion: workspace edits not sent are lost (the person had confirmed losing them), the personal rows become plain local data and go up again, as ties, at the next sign-in.

## Compatibility

- Older app, new server: `refused` is a new field the old app's `Reply` ignores (serde ignores unknown fields; no `deny_unknown_fields`). Nothing else the server sends changes.
- New app, current server: no `refused` comes back, so refused rows are counted as sent, as today. Binding, holding and leaving are all on the device; the current server already sends `team.me`.
- `held` is never sent to the server (the app sends nothing when it is set, and it is skipped when empty).
- No new tables or columns in the device's SQLite file: the binding, the leaving mark and the refused list are rows in `kv`. Each new core call is one `BEGIN IMMEDIATE` transaction, so an interrupted one leaves the file as it was.
- Merging with #101: both add a command to the one `generate_handler!` line in `crates/app/src/lib.rs` (the account commands here, `web_sign_in` there). #101 merged first; this branch is rebased on it with both names kept. Nothing else overlapped; `signIn` is untouched.

## Tests

- `crates/server/src/pg.rs` (the audit's tests, reshaped to assert the right behaviour):
  - F1: sign out of Julius, sign in as Geart: held with 3 unsent, nothing sent, all three titles still on the phone; Julius signs back in and all three reach his account; or Geart takes over and his account has none of Julius's rows.
  - F3: a row the server refuses stays unsent and reaches the right account later.
  - F2: after sign-out, and after deletion, the phone has no Hop rows, no assignees, no team; the person's own task is still there.
- `crates/core`: binding and holding, leave keeps personal rows, deleted leaves plain local data that goes up whole to a new account, refused rows get a new seq, the Inbox edit keeps its space, leaving twice is a no-op.
- Review of #112 (each failed first on c4e262c, output in the PR): `a_session_that_ended_keeps_unsent_workspace_edits`, `a_window_that_is_not_signed_in_changes_nothing_when_it_loads`, `an_account_made_again_keeps_the_phone_s_own_tasks`, `a_row_refused_twice_stays_on_the_device_and_is_not_sent_again` (pg.rs); `a_session_that_ended_takes_only_what_was_sent`, `leaving_happens_only_where_it_was_marked`, `a_round_that_was_answered_takes_a_stale_mark_away`, `a_row_refused_twice_is_kept_here_only` (core).
- `ui/src/lib`: counting unsent rows and the messages (`account-switch.test.ts`); the order of signing out and deleting, the last round, the wait for the round in flight, the focus session (`leave.test.ts`); a signed-out load and a 401, the deletion mark (`session-ended.test.ts`); taking over reloads whatever the round does (`take-over.test.ts`).

## Verified / not verified

Verified (27 Nov, on this branch):

- The audit's three tests fail on origin/main (eea3210) for the stated reasons (output in the PR).
- The reshaped tests fail with the fix switched off (holding, leaving, the refused re-send and the Inbox space fix disabled in core) and pass with it. `a_refused_row_is_sent_again` (core) fails with only the re-send switched off.
- After the review fixes: `cargo test -p done-core -p done-mcp -p done-server`: 44, 13 and 53 passed. `cargo check -p done-app` and `cargo check -p done-app --target aarch64-apple-ios` pass.
- `npm run typecheck`, `npm test` (683 passed), `npm run build` pass. `session-ended.test.ts` fails against the old `backend.ts`; `leave.test.ts` and `take-over.test.ts` fail against the old `leave.ts` and `store.ts`. `note-list.test.ts` failed once in a full run and passed alone and on the next full run; it does not touch anything changed here.

Not verified:

- A real iPhone, iPad or Mac app run: the Settings question, the held dialog, signing out and deleting on a device.
- The widgets and the Live Activity on a device. Read, not run: after leaving the window reloads, and `App.tsx` builds the snapshot from what `state()` returns, which no longer has workspace rows; a focus session on a workspace task is ended first.
- Two windows of the Mac app open while signing out (each reloads; the second loads after the file was cleaned).

Privacy of `refused`: it only names ids the writer sent itself. Whether such an id exists elsewhere could already be told from the reply (a row that did not exist comes back placed in the writer's space; one that did, does not).
