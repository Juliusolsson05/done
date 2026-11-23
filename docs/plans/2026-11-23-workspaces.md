# Workspaces: done for teams

Refs #49.
Branch `feat/workspaces` · Worktree `../done-wt/workspaces` · Base `origin/main` @ 14847bf (2026-11-23)
Status: **final, approved by the owner 23 Nov 2026.** Building starts with the interface mock (phase M), which the owner audits before any code. Size: long; a mock, then four phases, one PR each.

## Outcome

Any done user can create a workspace in Settings, name it, and invite people; Hop is the first, for the owner and the co-founder, Geart. Invites and other news arrive **inside done**, never by email. In a workspace you can:

- move one of your projects into it, so every member shares its tasks and notes, while your other projects stay private;
- switch between **All** (the default), your own space (your name and Google picture) and each workspace, from a picker at the bottom left of the sidebar;
- give a task **one or more assignees**, see their Google pictures wherever the task is shown, and see "Assigned to me";
- get a notification when someone invites you or assigns you a task;
- write a note together as in Google Docs: everyone's cursor and selection live, and who is in the note right now.

Someone who never creates or joins a workspace sees one new section in Settings and nothing else. The desktop app without an account keeps working exactly as today. Hosting stays on Google Cloud.

## Owner's answers (23 Nov 2026)

- Hosted data: "migrate the database to the solution that makes the most sense".
- Workspaces are open to every user, created in Settings.
- Avatars: the Google profile picture.
- **Several assignees per task.**
- Costs are fine, "just not 300 bucks a month".
- **Stay on Google Cloud** ("lets go with GCP").
- **No email**: invites and news as in-app notifications ("i hate the external email").
- **Lean infrastructure that grows when needed**; workspaces open to anyone (see "Lean, and how it grows").
- **All of the app's hosted data on Postgres** ("we can migrate all of the app to postgres"). Ruling: every account and workspace lives in Postgres; the Mac and iPhone apps keep their SQLite copy on the device, because that is what makes them work offline and without an account — cost if wrong: none to undo, the device file is a cache of the server for signed-in users.
- **A full mock of the interface first**, in one HTML file covering every scenario, so the owner can check the direction before anything is built.

## Evidence (verified, do not re-derive)

The code (origin/main 14847bf):
- `crates/core` is the only code that touches SQLite (`rusqlite`): `project`, `task` (subtasks by `parent_id`), `note`, `entry`. Every row has `changed` (ms) and `seq`; deletions leave tombstones; ids are 64-bit (time × 1000 + random) so devices create rows offline.
- Sync (`replica.rs`): `outbox()` → server `exchange()` (last write wins per row, ties keep what is there) → `inbox()`. One counter per file. Apps sync every 15 s while open, on focus and shortly after an edit.
- Hosting: the axum server (`crates/server`) on **Cloud Run** (us-west1, scale to zero, at most 2 instances); one SQLite file per account in a **Cloud Storage** bucket, put back whole after each change with a generation check (`accounts.rs`); secrets in Secret Manager; deployed with `done-infra/deploy.sh`; Cloudflare only forwards thedone.app.
- Sign-in: Google OpenID Connect; the session holds `sub`, verified `email`, `name`, `picture` (`auth.rs`).
- Notes: a plain `<textarea>` of Markdown, read with markdown-to-jsx; tasks mentioned as `[title](done:task/<id>)`.
- The MCP server (`done mcp`) works on the device's own SQLite file.

Research (web, 23 Nov 2026; sources at the end):
- **Storage.** A file per workspace in Cloud Storage fits a team poorly: about one write a second per object, every change re-uploads the whole file, two server instances collide on the generation check, and "All" or "Assigned to me" would open a file per workspace per request. On Google Cloud the fit is **Cloud SQL for PostgreSQL**: the smallest shared-core instance (db-f1-micro, 0.6 GB) is about $8–9 a month plus storage; always on (no cold start), no SLA on shared core (fine at this size). The next size up is about $26.
- **Sync engines.** None fits a Rust + SQLite client that writes offline (PowerSync's Rust SDK is alpha; Zero has no offline writes; Electric syncs reads only). Patterns to copy: Replicache's "space" (a slice everyone with access gets whole) and telling a device to drop a space it may no longer see; Linear's "sync groups".
- **Authorization.** The server decides which spaces a user is in on every request; every reference a row makes must belong to its space; a missing row and a forbidden row get the same answer (OWASP IDOR).
- **Assignees.** Todoist and Asana use one assignee; the owner needs several. One row per assignee keeps two people's concurrent changes (a list in one column would lose one).
- **Live notes.** Yjs is the most mature, smallest CRDT, with presence built in; `yrs` is its Rust port. CodeMirror 6 with `y-codemirror.next` edits the Markdown text itself and draws other people's cursors, so notes stay Markdown and task links, search and agents keep working. On Cloud Run, WebSockets last at most 60 minutes (clients reconnect; the Yjs provider does this by itself) and session affinity is only best effort — so the collaboration service runs as **one instance**, where every editor of a note meets in the same process. Hocuspocus is a maintained Yjs server (stable 4.x, persistence hooks, auth hook); `yrs` with the `y-sync` protocol is the Rust alternative.
- **Email.** Google Cloud has no transactional email service (its docs point to SendGrid, Mailjet, Mailgun). Not needed: invites are in-app.

## Decisions

Owner, 23 Nov: "make it so that the infra is not bloated but scales up as needed and that anyone using this app can set up a workspace". The defaults below are taken as answered; the owner can still change any of them before its phase is built.

1. **Roles:** owner and member. Owners invite, remove, rename, delete the workspace and move projects back out; members do everything else.
2. **The picker:** bottom left of the sidebar, above Settings: All, your name and picture, each workspace; shown once you are in a workspace. On the iPhone, at the top of the Lists screen.
3. **What All shows:** everything you can see, workspace tasks with a small workspace tag; Today and Upcoming in All show a workspace task only if it is assigned to you or to nobody. A workspace view shows everything in it.
4. **Moving a project:** from Settings → Workspaces and the project's right-click menu, with a confirmation naming who gains access. Moving back out is owner-only.
5. **The time sheet** stays personal, even for workspace tasks.
6. **Removing a member:** access ends at once on the server; their devices drop the workspace on the next sync; they are taken off every assignee list there. An offline or tampered device keeps what it had.
7. **Limits, since anyone can create workspaces:** 10 workspaces per account, 50 members per workspace, 20 invites a day per workspace, 50 pending. They protect the shared database, not a price plan.
8. **What notifies you:** an invite, and being assigned to a task by someone else. Not every change in the workspace.
9. **Live notes server:** Rust with `yrs` inside the **same server image**, started as `done collab`. Ruling: changed from Hocuspocus — one image, one language, nothing new to deploy or patch (lean-infra rule: same image, different command) — cost if wrong: more of the room logic (auth, saving, presence relay) written by us; Hocuspocus stays the fallback.
10. **Order:** phases 0 → 1 → 2 → 3.

## Architecture (Google Cloud)

```
thedone.app (Cloudflare forwards, as now)
   └─ Cloud Run "done" (the existing Rust server, 0 → up to 10 instances)
        ├─ Google sign-in, sessions (as now)
        ├─ /api/*: sync, workspaces, members, invites, notifications, moves
        └─ Cloud SQL for PostgreSQL (1 vCPU, 3.75 GB): every account's and workspace's data
   └─ Cloud Run "done-collab" (the same image, command `done collab`, 0 → 1 instance)
        └─ live note editing, cursors, presence; writes notes to the same database
```
Cloud Storage keeps only the migration backup, then goes. Secrets (database password, the ticket key shared by both services) in Secret Manager, values set once by hand. All of it in `done-infra` (flat Terraform), never in this repository.

### Lean, and how it grows

The app needs five things: the server, the live-notes room, one database, secrets, the domain. Each is one managed service; nothing else is added.

```
Needs:      server, live-notes room, postgres, secrets, domain
New:        Cloud SQL instance + database + user, one secret, one Cloud Run service (same image)
Idle cost:  ~$50/month — all of it Cloud SQL, paid from GCP credits while they last; both Cloud Run services scale to zero
Caps:       GCP has no hard spending cap. A $80/month budget alert, plus hard size limits:
            Cloud Run max 10 instances ("done") and 1 ("done-collab"), the database at a fixed size
Not added:  Redis, Pub/Sub, a queue, a staging copy, read replicas, high availability,
            an email service, a second image or language for live notes
```

Growing is a setting, not a redesign, and only on a measured number:

| Measured | Then | Cost after |
|---|---|---|
| Cloud Run instances busy | raise its max instances | pay per request, still $0 idle |
| Database CPU above ~70% for a day, or connections near the limit (~100 at 3.75 GB; each server instance keeps a pool of 5) | 2 vCPU / 7.5 GB, one command, a minute of downtime | ~$100/month |
| A day of downtime would hurt real customers | turn on high availability | about double |
| One live-notes instance is not enough | a Postgres `LISTEN/NOTIFY` relay between rooms, then more instances | — |

Anyone can create a workspace from Settings; the limits in decision 7 keep one account from filling the database.

### The shared code

- `done-core` is split: **rules and types** (what a valid task is, merge decisions, tombstones, `clean_folder`, mention parsing) with no SQLite; and the **`rusqlite` store**, used by the apps and the MCP server.
- New: a **Postgres store** in `crates/server` (sqlx), using the same rules.
- **One conformance suite** (recorded sync sequences) runs against both stores, so the two cannot drift apart.

### Spaces and sync

Every row belongs to a space: each account's personal space and each workspace.

Postgres:
```
account(id = Google sub, email, name, picture, created)
space(id, kind 'personal'|'workspace', name, owner_id, created, deleted)
member(space_id, account_id, role 'owner'|'member', joined, changed, seq, deleted)   PK(space_id, account_id)
invite(id, space_id, email, invited_by, token_hash, expires, accepted_at, declined_at, revoked_at, created)
notification(id, account_id, kind 'invite'|'assigned', space_id, task_id, invite_id, by_account, created, read_at)
space_seq(space_id, next)
project(id, space_id, …)              task(id, space_id, project_id, parent_id, created_by, …)
task_assignee(task_id, account_id, space_id, changed, seq, deleted)   PK(task_id, account_id)
note(id, space_id, …, ydoc BYTEA NULL)    entry(id, space_id = personal, …)
INDEX (space_id, seq) on every synced table
```
Devices (`crates/core`, SQLite): the same tables gain `space_id`; new `space`, `member`, `task_assignee` and `notification` tables; one sync position per space.

- **Pull:** one cursor per space; a space new to the device starts at 0, so joining brings all of it. The answer lists the spaces the caller is in now; a device drops any space no longer listed. Notifications for the caller come with the pull.
- **Push:** the server checks membership on every row. **The server owns `space_id`**: it takes it from the row's project (or the stored row) and ignores the client's; every `project_id`, `parent_id` and assignee must belong to the same space, or the row is refused. Guessing an id gets you nothing.
- **Conflicts:** last write wins per row, as now, with the server's receive time breaking ties and `changed` values far in the future refused. Assignees are rows of their own, so adding Geart and adding Julius at the same time keeps both.
- **Moving a project** is one server operation in one transaction: check ownership and membership, set the new `space_id` on the project, its tasks, subtasks, assignees and notes, with new `seq` values in the target space. An offline device's later edit is placed by the server where the row lives now, so it cannot move a row back.
- **Teammates' changes show** at the next sync (within about 15 seconds while the app is open); faster updates are a later step.

### Authorization

Every request: session → `spaces_for(account)` (one indexed query) → only those spaces; anything else is "not found". Owner-only operations check the role. Workspace content is other people's words: the device's MCP tools label each item with its workspace and author.

### Invites and notifications (no email)

- **Inviting:** Settings → Workspaces → *Hop* → Invite → the person's **Google email address**. The server stores the invite (7 days) and answers "Invited". Two ways it reaches them:
  - **In done:** if an account with that verified email exists, it gets a notification at once; if not, the invite waits and appears the first time someone signs in with that Google account.
  - **A link you send yourself:** "Copy invite link" (a 32-byte random token, only its hash stored, single use, 7 days). Opening it: "Julius invited you to Hop. Continue with Google." Accepted only by the Google account whose verified email matches; another account sees "This invite is for g•••@…; you are signed in as …".
- **Accepting:** Accept / Decline on the notification (or the link page); accepting writes the membership and opens the workspace.
- **Pending invites** show under the members with Copy link and Revoke. Limits per decision 7.
- **Notifications:** a bell at the bottom of the sidebar with a count; a short list ("Julius invited you to Hop" — Accept, Decline; "Geart assigned you 'Ship sync'" — opens the task); read when opened. On the iPhone, in the Lists screen. Delivered with sync; no push notifications in this plan.

### Assignees in the interface

- Rows and Board cards: up to three overlapping Google pictures at the right, then "+2"; workspace tasks only.
- Task editor and the iPhone details sheet: "Assignees", a member list with checks.
- Quick add: `+geart` (several allowed), with suggestions, as `#project` works.
- The Board/Timeline filter gains Assignee (Me, Nobody, each member).
- **Assigned to me**, a view in the sidebar while you are in a workspace.
- Right-click → Assign → member list.
- A note mention of a task you cannot see shows "Private task", never its title.

### Settings → Workspaces (everyone)

Empty: "Work on projects together. Create a workspace and invite people." with **Create workspace**. A workspace page: name (owner can rename), members with pictures and roles, pending invites, **Invite**, the projects in it, **Move a project here**, **Leave** (members) or **Delete workspace** (owner, typed confirmation).

### Live notes

- **First, alone:** the note editor becomes CodeMirror 6 (Markdown) for every note, keeping the @ picker, mention chips, links and undo; proven on Mac, web and the iPhone before any collaboration.
- A workspace note gets a Yjs document (`Y.Text` holding the Markdown). Opening it asks "done" for a 2-minute signed ticket (account, space, note, name, picture, colour) and connects to "done-collab" (`done collab`, the same image, speaking the `y-sync` protocol with `yrs`), which checks the ticket first.
- Cursors, selections and "who is here" come from Yjs presence, drawn by `y-codemirror.next`; the note list shows the pictures of who is in a note now.
- "done-collab" saves into the note's row in the database every few seconds while edited: the merged `ydoc` and the Markdown it gives, so search, the list, the read view and agents keep using the text. Two versions of a note's `ydoc` meeting in row sync are merged with `yrs`, not last-write-wins.
- An agent's whole-text `update_note` is applied as a diff, so a person's concurrent typing survives; it must send the version it read and is refused if the note changed since.
- Personal notes stay as today.

## Phases and tasks

Each phase is one PR in done (plus the matching change in `done-infra`), merged only on the owner's word, released, and checked on thedone.app.

**Phase M — the interface mock (before any code).**
One static HTML file, `docs/plans/2026-11-23-workspaces-mock.html`, drawn in done's own look (its colours, type and spacing), showing every screen and state this plan adds or changes, on the Mac and the iPhone: the picker, All and a workspace, assignees everywhere, quick add, the filter, right-click, the bell, Settings → Workspaces from empty to full, invites (in the app, by link, wrong account), moving a project, removal, live notes with cursors, and someone who never uses workspaces. The owner goes through it; every change of direction goes into this plan before phase 0 starts. The file is removed before the last phase merges.

**Phase 0 — Postgres and spaces under the hood (nothing visible changes).**
0.1 Split `done-core` into shared rules and the `rusqlite` store; all tests still pass.
0.2 `space_id` and per-space sync positions in `crates/core`; one personal space per account.
0.3 The Postgres store in `crates/server` (sqlx, migrations); the conformance suite passes against it.
0.4 `done-infra`: Cloud SQL (`db-custom-1-3840`, private to Cloud Run, 7-day backups), its secret, Cloud Run connected to it, max instances 10, the $80 budget alert. Infra receipt posted before apply.
0.5 Migration: a one-off tool reads each account's file from Cloud Storage with the `rusqlite` store and pushes its rows into that account's personal space through the sync protocol; counts compared; files kept as a read-only backup.
0.6 Cut over behind a setting; the old file path kept two weeks as the way back; then removed with the bucket.
Hands to phase 1: `spaces_for`, per-space sync, a personal space per account.

**Phase 1 — Workspaces, members, invites, notifications, the picker, moving projects.**
1.1 Workspaces: create, rename, delete; members; roles; limits.
1.2 Invites (by email address, in-app and by copied link); accept and decline; revoke.
1.3 Notifications: the table, delivery with sync, the bell and its list.
1.4 Settings → Workspaces (everyone).
1.5 The picker; All by default; every view scoped; workspace tags in All.
1.6 Move a project in and out, from Settings and right-click.
1.7 Leaving and removal; devices dropping a space.

**Phase 2 — Assignees.**
2.1 `task_assignee` end to end (core, server checks, sync); "assigned you" notifications.
2.2 Pictures on rows and cards, editor and details sheet, quick add `+name`, filter, Assigned to me, right-click.
2.3 MCP: assignees and workspace on every task; "assigned to me".

**Phase 3 — Live notes.**
3.1 CodeMirror 6 as the note editor everywhere, alone; proven on the iPhone.
3.2 `done collab` (same image, `yrs`) as a second Cloud Run service with one instance: rooms, tickets, presence, cursors.
3.3 `ydoc` in the note row, `yrs` merge in sync, saving from the room, agent edits as diffs.

## Tests

- Conformance (both stores): per-space cursors bring a new space whole; a dropped space is removed; a row pointing at a project, parent or assignee in another space is refused; a project move re-homes everything and an offline edit afterwards cannot move a row back; two members adding different assignees at once keeps both; ties broken by server time.
- Server: every endpoint answers another account's space with "not found"; owner-only operations; invites — to an existing account (notification at once), to an address with no account (appears at first sign-in), by link (single use, expired, wrong account, revoked), declined, limits; accepting writes the membership once.
- Interface: the picker scopes every view; All's Today rule; assignee pictures only on workspace tasks; `+name` in quick add; the bell and its list; Settings for someone with no workspace.
- Live notes: two editors converge; cursors and presence come and go; an agent update during typing keeps both; a reconnect after the 60-minute limit loses nothing.
- Migration: every row of a recorded account file arrives in its personal space unchanged.

## Verification

Each phase: the checks in AGENTS.md; a local run against a local Postgres on copies of the owner's data; then a real two-account test (the owner and a second Google account) on a Cloud Run preview revision before thedone.app. Phase 3 also needs the iPhone build on a device.

## Costs

Cloud SQL at 1 dedicated vCPU and 3.75 GB (`db-custom-1-3840`), about $50 a month (always on, the only idle cost), plus a little storage; both Cloud Run services scale to zero and cost cents at this size; no email service. **About $50–55 a month, paid from the owner's GCP credits** (and startup credits if redeemed). Ruling (owner, 23 Nov): start one step above the smallest — a dedicated core, the Cloud SQL SLA, no shared-core throttling, room for ~100 connections — cost if wrong: ~$40 a month more than the smallest; when the credits end, dropping to db-g1-small (~$26) is one command. See "Lean, and how it grows".

## Risks

1. **A leak between spaces** through a client-sent space or reference — prevented only by the server owning the space and checking every reference; the most important tests.
2. **Two SQL implementations** (apps on `rusqlite`, server on Postgres) drifting apart — one rules crate, one conformance suite against both.
3. **The migration** of every account into Postgres — counts compared, files kept, the old path kept two weeks.
4. **Lost edits** under row last-write-wins between people — receive-time ties; per-field merge later if it bites.
5. **Removal is best effort** on offline or tampered devices.
6. **Live notes on one Cloud Run instance** — the 60-minute reconnect and scale-to-zero must lose nothing (saves every few seconds; tested); if one instance is not enough, a Postgres `LISTEN/NOTIFY` relay, not a new service.
8. **Writing the room server ourselves** in `yrs` instead of Hocuspocus — kept small (tickets, rooms, save); Hocuspocus is the fallback if it drags.
7. **CodeMirror in the iPhone's web view** — proven alone (3.1) before collaboration.

## Out of scope

Email of any kind, push notifications, billing, roles beyond owner and member, guests, sharing a single task or note outside a workspace, comments, an activity log, Android, sign-in other than Google.

## Sources

Google Cloud: https://www.bytebase.com/dbcost/cloudsql/instance/db-f1-micro/ · https://firebase.google.com/docs/sql-connect/pricing · https://cloud.google.com/sql/docs/postgres/pricing · https://docs.cloud.google.com/run/docs/triggering/websockets · https://encore.dev/articles/cloud-run-websockets · https://docs.cloud.google.com/storage/quotas · https://docs.cloud.google.com/compute/docs/tutorials/sending-mail/using-mailjet
Sync and authorization: https://docs.powersync.com/client-sdks/reference/rust · https://zero.rocicorp.dev/docs/when-to-use · https://doc.replicache.dev/strategies/row-version · https://linear.app/now/rebuilding-delta-sync-read-path · https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html · https://developers.google.com/identity/openid-connect/openid-connect
Assignees and workspaces: https://asana.com/resources/why-one-assignee · https://todoist.com/help/articles/move-a-personal-project-to-a-team-workspace-B2boCmG9C · https://linear.app/docs/workspaces · https://www.notion.com/help/navigate-with-the-sidebar
Live notes: https://docs.rs/yrs/latest/yrs/ · https://github.com/yjs/y-codemirror.next · https://codemirror.net/docs/guide/ · https://tiptap.dev/docs/hocuspocus/getting-started/overview · https://tiptap.dev/docs/editor/markdown

## Build rulings (23 Nov, after reading the code)

The owner approved the mock and asked for the whole thing. Decisions made while building, each with why and the cost if wrong:

1. **`done-core` is not split.** Its rules (`check`, `check_entry`, `clean_folder`, days) become public and the server uses them; the device store stays in `done-core`; the Postgres store is a module of `crates/server` (`tokio-postgres` + `deadpool-postgres`, no ORM). The "conformance suite" is the real thing: tests run real device stores (SQLite) through the real Postgres store. — Splitting moves 1,800 lines for no behaviour. — Cost if wrong: a later split, mechanical.
2. **Old apps keep working.** The migration copies every row with its `seq`, `changed` and tombstones, so an app that has not updated (the iPhone is on 0.1.115) keeps syncing its own space with the cursor it has. Only new apps see workspaces. — Cost if wrong: an old app sees no workspace data until it updates, which is the intent.
3. **Where a row lives, decided by the server:** a task lives in its project's space, else its parent's, else the person's own space; a note in its project's space, else the space it was made in (checked), else its own; a project where it was made (checked), and moves only through "move to workspace"; time sheet entries are always personal. Putting a task into a project of another space moves it (you are in both); its assignees who are not in the new space are taken off. — Cost if wrong: one rule to change in one function.
4. **The web app in a browser saves row by row, last write wins**, like the apps already do, instead of refusing a save as "stale". With two people in one workspace, "stale" would throw away one person's edit every time the other typed. — Cost if wrong: two people editing the same field of the same task at the same moment keep the later one, as on the devices today.
5. **Today's goal is personal.** A task's goal day also records whose goal it is, so Geart making a Hop task his goal does not make it yours. — Cost if wrong: none; a goal was always one person's.
6. **Spaces, members and notifications reach a device whole** with every sync (a few hundred bytes for a team), and are kept as one record; tasks, projects, notes and assignees travel row by row as now.
7. **Inbox is personal**, so in a workspace a task without a project does not exist: quick add in a workspace with no project picks the workspace's first project.
