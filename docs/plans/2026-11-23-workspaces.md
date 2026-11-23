# Workspaces: done for teams

Refs #49 (opened with this plan).
Branch `feat/workspaces` · Worktree `../done-wt/workspaces` · Base `origin/main` @ 14847bf (2026-11-23)
Status: **plan only**, revised after the owner's first answers (23 Nov). Nothing is built. Size: long plan; four phases, one PR each.

## Outcome

Any done user can create a workspace in Settings, name it, and invite people by email; Hop is the first, for the owner and the co-founder, Geart. In a workspace you can:

- move one of your projects into it, so every member shares its tasks and notes, while your other projects stay private;
- switch between **All** (the default), your own space (shown with your name and Google picture) and each workspace, from a picker at the bottom left of the sidebar;
- give a task **one or more assignees**, see their Google pictures wherever the task is shown, and see "Assigned to me";
- write a note together as in Google Docs: everyone's cursor and selection live, and who is in the note right now.

Someone who never creates or joins a workspace sees one new section in Settings and nothing else. The desktop app without an account keeps working exactly as today.

All hosting moves to Cloudflare. Google Cloud is switched off after the move.

## Owner's answers (23 Nov 2026)

- Hosted data: "migrate the database to the solution that makes the most sense".
- Workspaces are open to every user, created in Settings: "that is kind of the point".
- Avatars: the Google profile picture.
- **Several assignees per task** — needed.
- Hosting: preferably all on Cloudflare, not Google Cloud; "not completely dog shit"; some cost is fine, "just not 300 bucks a month".
- Plan it with the Agent Code conventions.

## Evidence (verified, do not re-derive)

The code (origin/main 14847bf):
- `crates/core` is the only code that touches SQLite (`rusqlite`, bundled): `project`, `task` (subtasks by `parent_id`), `note`, `entry`. Every row has `changed` (ms) and `seq`; deletions leave tombstones; ids are 64-bit (time × 1000 + random) so devices create rows offline.
- Sync (`replica.rs`): `outbox()` → server `exchange()` (last write wins per row, ties keep what is there) → `inbox()`. One counter per file.
- Hosting today is **Google Cloud**, not Cloudflare: the axum server (`crates/server`) on Cloud Run (scale to zero, at most 2 instances), one SQLite file per account in a Cloud Storage bucket, put back whole after each change with a generation check (`accounts.rs`); secrets in Secret Manager. Cloudflare only forwards thedone.app to Cloud Run through a Worker (`done-infra/edge`). Deployed from the private `done-infra` repo.
- Sign-in: Google OpenID Connect; the session holds `sub`, verified `email`, `name`, `picture`; cookie for the web app, bearer token for the apps (`auth.rs`).
- Notes: a plain `<textarea>` of Markdown, read with markdown-to-jsx; tasks mentioned as `[title](done:task/<id>)` and drawn as live cards.
- The MCP server (`done mcp`) works on the device's own SQLite file.

Research (web, 23 Nov 2026; sources at the end):
- **Cloudflare can host all of it.** Workers run Rust (`workers-rs`, compiled to WebAssembly); its `http` feature runs an axum `Router`. Durable Objects with SQLite storage are supported from Rust (`state.storage().sql()`, an async API). Cloudflare recommends one Durable Object per coordination unit — "a tenant's workspace" is its own example: one instance in the world per name, its own SQLite next to the code, single-threaded, strongly consistent, about 500–1,000 simple requests a second each. D1 (Cloudflare's SQLite database) suits shared lookup tables. Workers Static Assets serves the React build with single-page-app fallback and sends `/api/*` to the Worker.
- **Cost:** Workers Paid is $5 a month and includes, per month, 25 billion SQLite rows read, 50 million written and 5 GB stored (Durable Objects; D1 has the same rates), plus the requests this app makes. On the free plan, hitting a limit makes operations fail, so Paid from the start.
- **The catch:** `rusqlite` does not build for the Workers target; the advice is to keep shared logic free of SQLite calls and put storage behind an interface. done's rules (what a valid task is, last-write-wins, tombstones) can be shared; the SQL for the server is a second implementation, held to the same tests.
- **Why not the alternatives:** one SQLite file per workspace in Cloud Storage takes about one write a second per object and re-uploads the whole file each change; Neon Postgres works but keeps three providers (Google Cloud, Neon, Cloudflare); no ready-made sync engine fits a Rust + SQLite client that writes offline.
- **Sync patterns to copy:** Replicache's "space" (a slice everyone with access gets whole) and its telling a device to drop a space it may no longer see; Linear's "sync groups".
- **Authorization:** the server decides which spaces a user is in on every request; every reference a row makes must belong to its space; a missing row and a forbidden row get the same answer (OWASP IDOR).
- **Assignees:** Todoist and Asana use one assignee; the owner needs several. Stored as one row per assignee, two people adding different assignees at once both survive under row sync (a list in one column would lose one of them).
- **Live notes:** Yjs (Rust port `yrs`) is the most mature, smallest CRDT, with presence built in. CodeMirror 6 with `y-codemirror.next` edits the Markdown text itself and draws other people's cursors, so notes stay Markdown and task links, search and agents keep working. `y-partyserver` runs a Yjs room as a Durable Object with hibernation; Cloud Run is a poor home for these sockets (60-minute limit, best-effort affinity).
- **Email:** Resend: free for 3,000 a month (100 a day), $20 a month for 50,000; an official Rust crate (or plain HTTP from the Worker); it writes its DNS records into Cloudflare. Cloudflare's own Email Service can send to anyone on Workers Paid (3,000 a month included) but is in public beta since April 2026. Invite links: at least 32 random bytes, only a hash stored, single use, 7-day expiry, bound to the invited address and accepted only by a Google account with that verified email (OWASP, Google OIDC guidance).

## Decisions

The owner's answers above are settled. Still open — answer by number, or "all defaults"; anything unanswered ships marked UNCONFIRMED:

1. **Roles.** *Default: owner and member.* Owners invite, remove, rename, delete the workspace and move projects back out; members do everything else.
2. **The picker.** *Default: at the bottom left of the sidebar, above Settings: All, your name and picture, each workspace; shown once you are in a workspace.* On the iPhone, at the top of the Lists screen.
3. **What All shows.** *Default: everything you can see,* each workspace task with a small workspace tag; Today and Upcoming in All show a workspace task only if it is assigned to you or to nobody (so a teammate's work does not crowd your day). A workspace view shows everything in it.
4. **Moving a project.** *Default: Settings → Workspaces, and the project's right-click menu,* with a confirmation naming who gains access. Moving it back out is owner-only.
5. **The time sheet.** *Default: stays personal,* even for workspace tasks.
6. **Removing a member.** *Default: access ends at once on the server; their devices drop the workspace on the next sync; they are taken off every task's assignees there.* An offline or tampered device keeps what it had.
7. **Limits, since anyone can create workspaces.** *Default: 10 workspaces per account, 50 members per workspace, 20 invites a day per workspace, 50 pending.* Raised by hand when needed.
8. **Email.** *Default: Resend* (stable; free at this size). Alternative: Cloudflare Email Service (one provider fewer, included in the $5, but in beta).
9. **Order.** *Default: phases 0 → 1 → 2 → 3,* so shared projects with assignees (1–2) come before live notes (3).

## Architecture (all Cloudflare)

```
thedone.app ── Worker "done" (Rust, workers-rs + axum)
               ├─ Static Assets: the React build (single-page app)
               ├─ /auth/*  Google sign-in (unchanged flow), sessions
               ├─ /api/*   sync, workspaces, members, invites, moves
               ├─ D1 "directory": accounts, spaces, members, invites
               └─ Durable Object "Space" — one per space (each account's personal
                  space and each workspace): its own SQLite with the projects,
                  tasks, assignees, notes, entries of that space; sync; a WebSocket
                  that tells open apps "something changed" so teammates' edits show
                  in seconds, not at the next 15-second poll
Worker "done-collab" (TypeScript, y-partyserver)
               └─ Durable Object "Note" — one per open workspace note: live
                  editing, cursors, presence; saves into its Space
Resend ─ invite emails
```

Why this shape: a Space Durable Object is today's "one SQLite file per account", made per space and with one writer by design — no whole-file uploads, no generation conflicts, no second database for content. The directory is small and global (who is in what), which is what D1 is for.

### The shared code

- `done-core` is split: **rules and types** (what a valid task is, merge decisions, tombstones, `clean_folder`, mention parsing) with no SQLite, compiled for both the apps and WebAssembly; and the **`rusqlite` store**, behind a feature, for the apps and the MCP server only.
- New crate `done-space`: the Space Durable Object's store, on the Durable Object SQL API, using the shared rules.
- **One set of conformance tests** (recorded sync sequences) runs against both stores, so the two SQL implementations cannot drift apart.

### Spaces and sync

Every row belongs to a space. Directory (D1):
```
account(id = Google sub, email, name, picture, created)
space(id, kind 'personal'|'workspace', name, owner_id, created, deleted)
member(space_id, account_id, role 'owner'|'member', joined)          PK(space_id, account_id)
invite(id, space_id, email, invited_by, token_hash, expires, accepted_at, revoked_at)
```
Each Space Durable Object (SQLite): today's tables plus
```
task_assignee(task_id, account_id, changed, seq, deleted)   PK(task_id, account_id)
member_view(account_id, name, picture, role, changed, seq)   -- what devices need to draw members
task.created_by, note.ydoc (BLOB, workspace notes only)
```
Devices (`crates/core`, SQLite): the same tables gain `space_id`; new `space`, `member_view` and `task_assignee` tables. A device keeps one sync position per space.

- **Pull:** one cursor per space (`{space_id: seq}`); a space new to the device starts at 0, so joining brings all of it. The answer also lists the spaces the caller is in now; a device drops any space no longer listed.
- **Push:** the Worker routes each row to its space's Durable Object only after checking membership in the directory. **The server owns `space_id`**: it takes it from the row's project (or the stored row) and ignores the client's; every `project_id`, `parent_id` and assignee must belong to the same space, or the row is refused. Guessing an id gets you nothing.
- **Conflicts:** last write wins per row, as now, with the Durable Object's own receive time breaking ties and `changed` values far in the future refused. Assignees are rows of their own, so adding Geart and adding Julius at the same time keeps both.
- **Moving a project** is one server operation: check ownership and membership, copy the project with its tasks, subtasks, assignees and notes into the target Space (keeping ids), then tombstone them in the source. Devices see them leave one space and arrive in the other. An offline device's later edit is routed by the server to where the row lives now, so it cannot move it back.

### Authorization

Every request: the session's account → `spaces_for(account)` from D1 (cached a few seconds in the Worker) → the request may touch only those spaces; anything else is "not found". Owner-only operations check the role. Workspace content is other people's words: the device's MCP tools label each item with its workspace and author, so an agent can tell a colleague's text from the owner's.

### Invites

Settings → Workspaces → *Hop* → Invite: an email address. The Worker stores a hash of a 32-byte random token (7 days) and sends through Resend: from "Julius (via done) <invites@thedone.app>", reply-to the inviter; subject "Julius invited you to Hop on done"; one button, "Join Hop", the plain link under it, a plain-text part, no tracking. The link opens "Julius invited you to Hop. Continue with Google." After sign-in the invite is accepted only if the Google account's verified email matches (case ignored); then the membership is written and the app opens in Hop. A different account sees "This invite is for g•••@…; you are signed in as …" with "Use another Google account". Pending invites show under the members with Resend and Revoke. The invite form always answers "Invite sent". Limits per decision 7.

### Assignees in the interface

- Rows and Board cards: up to three overlapping Google pictures at the right, then "+2"; only for workspace tasks.
- Task editor and the iPhone details sheet: "Assignees", a member list with checks.
- Quick add: `+geart` (several allowed), with suggestions, as `#project` works.
- The Board/Timeline filter gains Assignee (Me, Nobody, each member).
- **Assigned to me**, a view in the sidebar while you are in a workspace.
- Right-click → Assign → member list.
- Note mentions of a task you cannot see show "Private task", never its title.

### Settings → Workspaces (everyone)

Empty state: "Work on projects together. Create a workspace and invite people by email." with **Create workspace**. A workspace page: name (owner can rename), members with pictures and roles, pending invites, **Invite**, the projects in it, **Move a project here** (your projects), **Leave** (members) or **Delete workspace** (owner, typed confirmation).

### Live notes

- **First, alone:** the note editor becomes CodeMirror 6 (Markdown) for every note, keeping the @ picker, mention chips, links and undo; proven on Mac, web and the iPhone before any collaboration.
- A workspace note gets a Yjs document (`Y.Text` holding the Markdown). Opening it asks the Worker for a 2-minute signed ticket (account, space, note, name, picture, colour) and connects to `done-collab`'s Note room, which checks the ticket first.
- Cursors, selections and "who is here" come from Yjs presence, drawn by `y-codemirror.next`; the note list shows the pictures of who is in a note now.
- The room saves into the Space every few seconds while edited: the merged `ydoc` and the Markdown it gives, so search, the list, the read view and agents keep using the text. Two versions of a note's `ydoc` meeting in row sync are merged with `yrs`, not last-write-wins.
- An agent's whole-text `update_note` is applied as a diff, so a person's concurrent typing survives; it must send the version it read and is refused if the note changed since.
- Personal notes stay as today, without collaboration.

## Phases and tasks

Each phase is one PR in done (plus the matching change in `done-infra`), merged only on the owner's word, released, and checked on thedone.app.

**Phase 0 — Move to Cloudflare (nothing visible changes).**
0.1 Split `done-core` into shared rules and the `rusqlite` store (feature-gated); all tests still pass.
0.2 `space_id` and per-space sync positions in `crates/core`; one personal space per account.
0.3 `done-space`: the Space Durable Object store on the Durable Object SQL API; the conformance tests pass against it (run under `wrangler dev`/Miniflare).
0.4 The `done` Worker: axum on workers-rs; Google sign-in and sessions ported from `auth.rs`; Static Assets for the UI; the directory in D1.
0.5 Migration: a one-off tool reads each account's file from Cloud Storage with the existing `rusqlite` store and pushes its rows into that account's personal Space through the sync protocol; files kept as a read-only backup.
0.6 Cut over: thedone.app served by the new Worker; Cloud Run kept for two weeks as the way back; then Cloud Run, the bucket and the secrets are deleted.
Hands to phase 1: `spaces_for`, per-space sync, a Space per account, the live "something changed" socket.

**Phase 1 — Workspaces, members, invites, the picker, moving projects.**
1.1 Directory: create, rename, delete a workspace; members; roles; limits.
1.2 Invites through Resend; the accept page and flow; resend, revoke.
1.3 Settings → Workspaces (everyone).
1.4 The picker; All by default; every view scoped; workspace tags in All.
1.5 Move a project into (and back out of) a workspace, from Settings and right-click.
1.6 Leaving and removal; devices dropping a space.

**Phase 2 — Assignees.**
2.1 `task_assignee` end to end (core, Space checks, sync).
2.2 Pictures on rows and cards, editor and details sheet, quick add `+name`, filter, Assigned to me, right-click.
2.3 MCP: assignees and workspace on every task; "assigned to me".

**Phase 3 — Live notes.**
3.1 CodeMirror 6 as the note editor everywhere, alone; proven on the iPhone.
3.2 `done-collab` Worker: Note rooms, tickets, presence and cursors.
3.3 `ydoc` in the note row, `yrs` merge in sync, saving from the room, agent edits as diffs.

## Tests

- Conformance (both stores): per-space cursors bring a new space whole; a dropped space is removed; a row pointing at a project, parent or assignee in another space is refused; a project move re-homes everything and an offline edit afterwards cannot move a row back; two members adding different assignees at once keeps both; ties broken by server time.
- Worker: every endpoint answers another account's space with "not found"; owner-only operations; invite tokens single use, expired, wrong email, revoked, resent, rate-limited; accepting writes the membership once.
- Interface: the picker scopes every view; All's Today rule; assignee pictures only on workspace tasks; `+name` in quick add; Settings for someone with no workspace.
- Live notes: two editors converge; cursors and presence come and go; an agent update during typing keeps both.
- Migration: every row of a recorded account file arrives in its Space unchanged (counts and contents compared).

## Verification

Each phase: the checks in AGENTS.md; a local run (`wrangler dev`) on copies of the owner's data; then a real two-account test (the owner and a second Google account) on a preview deployment before thedone.app. Phase 3 also needs the iPhone build on a device.
Owner actions: Cloudflare Workers Paid ($5/month) on the account that holds thedone.app; a Resend account with thedone.app verified (it adds the DNS records to Cloudflare).
Not verifiable here: email arriving in Geart's inbox until Resend is set up.

## Costs

Workers Paid **$5/month** covers the Worker, Durable Objects, D1, Static Assets and the live note rooms at this size (25 billion rows read, 50 million written, 5 GB stored included). Resend free up to 3,000 emails a month. Google Cloud goes to $0 after the move. If done grows to many outside teams: a few dollars more in usage, and $20/month for Resend past 3,000 emails — still far from $300.

## Risks

1. **A leak between spaces** through a client-sent space or reference — prevented only by the server owning the space and checking every reference; the most important tests.
2. **Two SQL implementations** (apps on `rusqlite`, server on Durable Object SQL) drifting apart — one rules crate, one conformance suite run against both.
3. **The move off Google Cloud** — a migration of every account, and Rust on Workers being younger (async-only SQL from Rust, local testing quirks); mitigated by keeping Cloud Run as the way back for two weeks and by the migration comparing counts.
4. **Lost edits** under row last-write-wins between people — receive-time ties; per-field merge later if it bites.
5. **Removal is best effort** on offline or tampered devices.
6. **CodeMirror in the iPhone's web view** — proven alone (3.1) before collaboration.

## Out of scope

Billing and paid plans, roles beyond owner and member, guests, sharing a single task or note outside a workspace, comments, notifications and email digests, an activity log, Android, sign-in other than Google.

## Sources

Cloudflare: https://github.com/cloudflare/workers-rs · https://docs.rs/worker/latest/worker/struct.SqlStorage.html · https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects · https://blog.cloudflare.com/sqlite-in-durable-objects · https://developers.cloudflare.com/durable-objects/platform/pricing · https://developers.cloudflare.com/changelog/2025-12-12-durable-objects-sqlite-storage-billing · https://developers.cloudflare.com/use-cases/saas/data-isolation · https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ · https://ma.rkusa.st/store-sqlite-in-cloudflare-durable-objects · https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md
Storage alternatives and sync: https://docs.cloud.google.com/storage/quotas · https://neon.com/pricing · https://docs.powersync.com/client-sdks/reference/rust · https://zero.rocicorp.dev/docs/when-to-use · https://doc.replicache.dev/strategies/row-version · https://linear.app/now/rebuilding-delta-sync-read-path · https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
Assignees and workspaces: https://asana.com/resources/why-one-assignee · https://todoist.com/help/articles/move-a-personal-project-to-a-team-workspace-B2boCmG9C · https://linear.app/docs/workspaces · https://www.notion.com/help/navigate-with-the-sidebar
Live notes: https://docs.rs/yrs/latest/yrs/ · https://github.com/yjs/y-codemirror.next · https://codemirror.net/docs/guide/ · https://docs.cloud.google.com/run/docs/triggering/websockets · https://tiptap.dev/docs/editor/markdown
Email: https://resend.com/pricing · https://resend.com/docs/dashboard/domains/cloudflare · https://developers.cloudflare.com/email-service/platform/pricing/ · https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html · https://developers.google.com/identity/openid-connect/openid-connect
