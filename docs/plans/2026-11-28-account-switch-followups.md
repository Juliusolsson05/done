# Account switch: the follow-ups

Fixes #120: the minor findings left after the second review of #112 (`docs/plans/2026-11-27-account-switch-data.md`).

## Outcome

- A. A row refused twice goes again once its account signs in again, and while it is only on this device the task says so.
- B. A leaving mark is finished only by the app that wrote it. A signed-in app completes its own stale mark when it starts.
- C. A mark is never finished as a deletion unless the server confirmed the deletion, and taking a mark back is not swallowed when it fails.
- D. When Apple ends the credential, a focus session on a workspace task ends too, so its title leaves the Live Activity.
- E. After a session ends, the workspace rows kept to be sent stay on the device but are left out of the widgets.

## Evidence

Each item has a test written first and run on origin/main (34d2745). All of them fail (output in the PR):

- A `a_row_refused_twice_goes_again_when_the_account_signs_in_again` (pg.rs): Julius's account keeps `["Inbox thing"]` after he signs in again.
- B `a_mark_is_finished_only_by_the_app_that_wrote_it` (core): a load by another app finishes the mark (`Some(Left { how: SignedOut, removed: 3, .. })`).
- C `a_deletion_not_confirmed_is_never_finished_as_one` (core): the unsent workspace edit is gone after a deletion that was never confirmed. `session-ended.test.ts`: the take-back is called once, and the marks are `['deleted']` before the server answers.
- D `apple-revocation.test.ts`: the window's own sign-out is never called.
- E `widget-snapshot.test.ts`: the snapshot lists `Ship the site`, a workspace task kept while signed out.

## Decisions

A. **Refused twice: kept here, released at the next sign-in.** The second refusal still clears the row's space and stops sending it. It is now also listed in `kv 'local_only'`. That list is released, meaning the rows become unsent again and the refused record is cleared, at two points:
   - when leaving finishes, as when a session ends;
   - at the first round of a sign-in, which is a round with no space cursors (leaving removes them, and a new file has none).

   Each release allows at most two more sends, so there is no loop: once per sign-in. `State.localOnly` lists the tasks in that list. The task editor says "Only on this device. It was not accepted by your account." (`ui/src/lib/on-device.ts`).

B. **Marks have an owner.** `kv 'leaving'` holds `{how, by}`, where `by` is an id kept in the app's own web storage (`done-app-owner`). The "done next" preview has its own web storage, so it has a different id.
   - `finish_leaving(by)` finishes only its own mark.
   - A signed-in app, when it starts, asks for its own mark (`own_mark(by)`). If it is "ended", "signed-out" or "deleted", the app completes it: forget the session, finish, reload. The person had chosen that, or the session is gone.
   - If it is "deleting", the app takes it back, because the server never said yes.
   - A foreign mark is left alone. Any successful round still takes every mark away, as before: the account is there.

C. **"deleting" before the server answers, "deleted" after it confirmed.** "deleting" is finished as "ended": nothing unsent goes, and the file stays bound to the account. Order of strength is ended < deleting < signed-out < deleted:
   - A 401 during a deletion cannot weaken it.
   - A later sign-out replaces a "deleting" that is left over.

   Taking the mark back after a refusal is tried three times, and if it still fails the error says so.
D. `watchAppleSession(onEnded)`: the sign-in screen passes `signOutChecked(true, 'ended')` from `lib/leave.ts`. That stops syncing, waits for the round in flight and ends a focus session on a workspace task. Without a handler, `signOut('ended')` runs as before.
E. `State.withheld`: while the file has no team (signed out, or held for another account), the ids of tasks in a space other than the bound account's personal one. `widgetSnapshot` leaves them out. The window still lists them, because they are the person's unsent work.

Ruling: a mark written by the previous version (a bare string, no owner) is finished by any app's load, as before. The app that wrote it cannot be known, and leaving it unfinished would keep workspace rows after a confirmed sign-out. Cost if wrong: such a mark, left by a crash of 0.1.327 in the middle of a sign-out, can be finished by "done next".

Ruling: the owner id lives in web storage. Cost if wrong: if storage is cleared or refused, a mark left by a crash is not finished by that app's next load. Workspace rows then stay until a round or a sign-out, and nothing is lost.

## Compatibility

- `State` gains `localOnly` and `withheld`. Both are left out when empty, and the web app's server sends neither. Older windows ignore them.
- No server change, and no new tables or columns: the owner and the list are `kv` rows.
- App commands: `mark_leaving` and `finish_leaving` take `by`, and `own_mark` is new. The UI and the app ship together.

## Tests

The tests named under Evidence, with their counterparts in core:

- the release at sign-in;
- the owner rule for marks;
- "deleting" finished as "ended";
- `State.withheld`.

On the UI side:

- `on-device.test.ts`;
- the owner passed to every mark;
- the stale own mark completed on start.

## Verified / not verified

- Verified: see the PR.
- Not verified: a real device. That covers the Live Activity ending, the widgets after a session ends, and "done next" next to the real app.
