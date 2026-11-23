# Workspaces: done for a small team

Branch `feat/workspaces` · Worktree `../done-wt/workspaces` · Base `origin/main` @ 14847bf (2026-11-23)
Status: **plan only**, for the owner to read and answer the decisions. Nothing is built. Size: long plan; delivered in phases, one PR each.

## Outcome

done becomes the to-do and notes app for the owner's startup, Hop, starting with the owner and the co-founder, Geart, and growing to perhaps 5–10 people. For anyone not in a workspace nothing changes. Someone in one can:

- create a workspace in Settings, name it ("Hop"), and invite people by email; they get an email, sign in with Google and are in;
- move one of their projects into the workspace, so everyone in it shares its tasks and notes, while personal projects stay private;
- switch between **All**, their own personal space and each workspace from a picker at the bottom left of the sidebar; All is the default;
- assign a task to a member, see who it is assigned to everywhere a task is shown, and see "Assigned to me";
- write a note together with the rest of the workspace as in Google Docs: everyone's cursor and selection live, and who is in the note right now.

## Evidence (verified, do not re-derive)

The code (origin/main 14847bf):
- `crates/core` is the only code that touches SQLite: tables `project`, `task` (subtasks by `parent_id`), `note` (`folder`, `project_id`), `entry` (time sheet). Every row has `changed` (ms) and `seq`; deletions leave tombstones; ids are 64-bit (time × 1000 + random) so devices create rows offline (`replica.rs`, `fresh_id`).
- Sync (`replica.rs`): a device sends `outbox()` rows since `pushed`; the server merges with `exchange()` (last write wins per row, ties keep what is there) and answers rows since the device's `pulled`; `inbox()` applies them. One counter per file.
- Hosting (`crates/server/src/accounts.rs`): one SQLite file per account, the Google `sub`, in a GCS bucket. The server downloads it, trusts its copy for 30 s, serves one request per account at a time, and puts the **whole file** back with a generation precondition; a conflict throws the copy away and answers `Stale`. Cloud Run, scale to zero, at most 2 instances; thedone.app reaches it through a Cloudflare Worker (private repo `done-infra`).
- Sign-in (`auth.rs`): Google OpenID Connect; the session holds `sub`, `email` (verified), `name`, `picture`; cookie for the web app, bearer token for the apps.
- Notes are a plain `<textarea>` of Markdown, read with markdown-to-jsx; tasks are mentioned as `[title](done:task/<id>)` and drawn as live cards.
- The MCP server (`done mcp`) works on the device's own SQLite file: `list_tasks, add_task, update_task, complete_task, reopen_task, delete_task, list_projects, add_project, list_notes, add_note, update_note, delete_note, time_sheet`.
- The desktop app works with no account at all, on its local file; sign-in is optional.

Research (web, 23 Nov 2026; sources at the end):
- **Storage.** A file per workspace in GCS fits a team poorly: GCS allows about one write per second to one object, every change re-uploads the whole file, two server instances collide on the generation check, and "All" or "Assigned to me" would open a file per workspace per request. A serverless Postgres fits: Neon's free plan (projects suspend after 5 idle minutes, resume in a few hundred ms; 0.5–1 GB, 100 CU-hours a month), then pay-as-you-go with no monthly minimum. Supabase's free projects pause after a week; Cloud SQL never scales to zero.
- **Sync engines.** None fits a Rust + SQLite client that writes offline (PowerSync's Rust SDK is alpha; Zero has no offline writes; Electric syncs reads only; Instant and Jazz have no Rust client). The patterns to copy: Replicache's "space" (a slice everyone with access gets whole) and its way of telling a device to drop rows it may no longer see; Linear's "sync groups".
- **Authorization.** The server, not the client, decides which spaces a user is in, on every request; every row reference (`project_id`, `parent_id`, `assignee_id`) must belong to the row's space; a missing row and a forbidden row get the same answer (OWASP IDOR).
- **Assignees.** One assignee per task is what Todoist, Asana ("Why one assignee?") and Jira do; shared work is split into subtasks with their own assignee. Many-to-many "collaborators" are a known source of confusion.
- **Live notes.** Yjs (with `yrs`, its Rust port) is the most mature and smallest CRDT, with presence ("awareness") built in. CodeMirror 6 with `y-codemirror.next` edits the Markdown text itself and draws other people's cursors, so notes stay Markdown and task links, search and agents keep working; rich-text editors (Tiptap, BlockNote) would turn notes into a document tree and lose Markdown on the way back. Cloud Run is a poor home for collaboration sockets (60-minute limit, best-effort affinity, an open socket keeps an instance billed, two instances need a shared bus); a Cloudflare Durable Object per note is one place every editor connects to, hibernates when idle, and done's domain already runs through Cloudflare. About $5 a month on the Workers Paid plan for a team this size.
- **Email.** Resend: free for 3,000 emails a month (100 a day), an official Rust crate, and it writes its own DNS records into Cloudflare. Invite links follow OWASP's reset-token rules: at least 32 random bytes, only a hash stored, single use, 7-day expiry, bound to the invited address and accepted only by a Google account with that verified email.

## Decisions

Answer by number; "all defaults" is fine. Unanswered ones ship marked UNCONFIRMED.

1. **Where hosted data lives.** *Default: Neon Postgres behind the existing Cloud Run server*, one database for all accounts and workspaces; devices keep their own SQLite and the row sync they have now. Alternative: a SQLite file per workspace in the bucket, at most one server instance — cheaper to build, but every change re-uploads the whole file and it will not grow past a few people.
2. **Live notes.** *Default: Yjs + CodeMirror 6, synced through one Cloudflare Durable Object per note (y-partyserver), about $5 a month (Workers Paid).* Alternative: notes shared without live editing (last write wins per note, as today) — free, but two people writing the same note at once lose each other's words.
3. **Roles.** *Default: owner and member.* Owners invite, remove, rename and delete the workspace and move projects out; members do everything else.
4. **Assignees.** *Default: one per task, optional.* Several people means subtasks, each with its own.
5. **The picker.** *Default: at the bottom left of the sidebar, above Settings, as asked*: your name (your personal space), each workspace, and **All** (the default). Hidden until you are in a workspace.
6. **What All shows.** *Default: your personal tasks and every task in your workspaces,* each workspace task marked with a small workspace tag; Today and Upcoming in All show workspace tasks only when they are assigned to you or to nobody. A workspace view shows everything in it.
7. **Moving a project.** *Default: from Settings → Workspace, and from a project's right-click menu,* with a confirmation that says who will gain access. Moving back out is owner-only.
8. **The time sheet.** *Default: stays personal,* even for workspace tasks.
9. **Removing a member.** *Default: their access ends at once on the server; their devices drop the workspace on their next sync; tasks assigned to them become unassigned.* An offline or tampered device keeps what it had; that cannot be prevented.
10. **Email.** *Default: Resend*, sending as `Julius (via done) <invites@thedone.app>`, reply-to the inviter.
11. **Order of work.** *Default: phases 0 → 1 → 2 → 3 below,* so Geart can use a shared Hop workspace with assignees (phases 1–2) before live notes (phase 3).

## Design

### Spaces

Every row belongs to a **space**. Each account has one personal space (created on first sign-in or on migration, holding all existing rows); each workspace is a space.

Server (Postgres):
```
account(id = Google sub, email, name, picture, created)
space(id, kind 'personal'|'workspace', name, owner_id, created, changed, seq, deleted)
member(space_id, account_id, role 'owner'|'member', joined, changed, seq, deleted)  PK(space_id, account_id)
invite(id, space_id, email, invited_by, token_hash, expires, accepted_at, revoked_at, created)
project(id, space_id, name, color, changed, seq, deleted)
task(id, space_id, project_id, parent_id, assignee_id NULL, created_by, …today's columns…, changed, seq, deleted)
note(id, space_id, project_id, folder, text, updated_at, ydoc BYTEA NULL, changed, seq, deleted)
entry(id, space_id = the personal space, task_id, …)
space_seq(space_id, next)   -- one counter per space
INDEX (space_id, seq) on every synced table
```
Device (SQLite, `crates/core`): the same tables gain `space_id`, `assignee_id`, `created_by`; new `space` and `member` tables (synced, so a device can show names, avatars and the picker). The local-only desktop app (no account) has one implicit personal space and never sees any of this.

### Sync with spaces

- A device's pull carries one cursor per space (`{space_id: seq}`); a space new to it starts at 0, so joining a workspace brings all of it, not only what changed after.
- The server answers with the rows past each cursor **and the list of spaces the caller is in now**. A device holding a space no longer listed deletes it locally (Replicache's `clear`).
- **The server owns `space_id`.** On push it ignores the client's value and takes it from the row's project (or keeps the stored one); it checks that every `project_id`, `parent_id` and `assignee_id` the row points at belongs to the same space, and refuses the row otherwise. This is what stops one account attaching a task to another's project by guessing an id.
- Conflicts stay last-write-wins per row; the server records its own receive time to break ties and refuses `changed` values far in the future (two people's clocks differ more than one person's devices). Per-field merge for tasks is a possible later step.
- **Moving a project** is a server operation, not row edits: in one transaction, check the caller owns the project and is in the target space, then re-home the project, its tasks, subtasks and notes with new `seq` values in the target space. An offline device's later edit of one of those rows cannot move it back, because the server owns `space_id`.

### Authorization

One function, `spaces_for(account)`, read from `member` on every request; every query is scoped to it; a row outside it is "not found". Owners-only operations check the role. The device's MCP server keeps working on the device's own file, which now holds the workspace rows it is allowed; its tools gain `assignee` and `workspace` fields and a filter for "assigned to me". Workspace text is input from other people: tool results label each item with its workspace and author, so an agent can tell a colleague's words from the owner's.

### Invites

Owner enters an email in Settings → Workspace → Invite. The server stores a hash of a 32-byte random token (7-day expiry) and sends via Resend: subject "Julius invited you to Hop on done", one button "Join Hop", the plain link below it, a plain-text part, no tracking. The link opens a page: "Julius invited you to Hop. Continue with Google." After sign-in the invite is accepted only if the Google account's verified email matches (case ignored) — then, in one transaction, `accepted_at` is set and the member row written, and the app opens in the workspace. A different account gets "This invite is for g•••@hop.app; you are signed in as …" with "Use another Google account". Pending invites show under the members with Resend and Revoke; Resend issues a new token. Limits: 20 invites a day per workspace, 50 pending, one resend per address per 10 minutes. The invite form always answers "Invite sent".

### Assignees in the interface

- Task row and Board card: a small initials avatar at the right, only for workspace tasks.
- Task editor and the iPhone details sheet: an "Assignee" row (members of the task's workspace).
- Quick add: `+name` assigns (as `#project` picks a project), with the same suggestion list.
- The Board/Timeline filter gains "Assignee" (including "Me" and "Nobody").
- A new view, **Assigned to me**, in the sidebar while you are in a workspace.
- Right-click → Assign to ….
- Mentions in notes: a task you cannot see shows as "Private task", never its title.

### Live notes

- The note editor becomes CodeMirror 6 (Markdown mode) instead of the textarea, for every note; the read view and task cards stay as they are. Done first and alone, before any collaboration, so the editor change is proven on Mac, web and iPhone by itself.
- A workspace note gets a Yjs document (`Y.Text` holding the Markdown). Opening it asks Cloud Run for a short-lived signed ticket (user, workspace, note, name, colour; 2 minutes) and connects to `wss://thedone.app/collab/<room>` — a Durable Object per note behind the existing Cloudflare Worker, which checks the ticket before accepting.
- Cursors, selections and "who is here" come from Yjs awareness, drawn by `y-codemirror.next`; the note list shows the faces of who is in a note now.
- The Durable Object saves to Cloud Run every few seconds while edited: the merged `ydoc` and the Markdown it gives. The note row keeps `text` (for search, the list, agents and the read view) and gains `ydoc`. When two versions of a note's `ydoc` meet in row sync, they are merged with `yrs`, not last-write-wins.
- An agent's `update_note` (whole new text) is applied as a diff to the document, so concurrent edits survive; it must send the version it read and is refused if the note changed since.
- Personal notes keep working as today, without collaboration.
- Undo in the note editor is Yjs's own (your own edits only).

### Infrastructure (private repo `done-infra`, never this repo)

- Neon project (free plan), its URL as a Cloud Run secret.
- Resend: domain `thedone.app` verified (records on Cloudflare), API key as a secret.
- Cloudflare Workers Paid ($5/month) for Durable Objects; the existing `edge/` Worker gains the collaboration route and the ticket key (shared with Cloud Run).
- Infra receipt and ledger in `done-infra/LOOP.md` as for the first deploy.

## Phases and tasks

Each phase is one PR in done (plus the matching done-infra change), merged only on the owner's word.

**Phase 0 — Spaces under the hood (no visible change).**
0.1 Postgres layer in `crates/server` (sqlx), schema above, migrations.
0.2 `space_id` in `crates/core` tables and `replica.rs`; per-space cursors; the server-owned space rule.
0.3 One-off migration: each account's GCS file → its personal space in Neon; files kept read-only as a backup.
0.4 Switch the hosted server to Postgres behind a setting; release; watch; remove the GCS path after a week.
Hands to phase 1: `spaces_for`, per-space sync, a personal space per account.

**Phase 1 — Workspaces, members, invites, the picker, moving projects.**
1.1 Server: create, rename and delete a workspace; members; invites (Resend); accept flow and page; limits.
1.2 Settings → Workspace: create, name, members, pending invites, invite, move a project in.
1.3 Sidebar picker (bottom left), All by default; views scoped to the chosen space; workspace tags in All.
1.4 Right-click → Move to workspace (with the confirmation).
1.5 Removing a member and devices dropping the space.

**Phase 2 — Assignees everywhere.**
2.1 `assignee_id` end to end (core, server checks, sync).
2.2 Row, card, editor, details sheet, quick add `+name`, filter, Assigned to me, right-click.
2.3 MCP: assignee and workspace fields, "assigned to me".

**Phase 3 — Live notes.**
3.1 CodeMirror 6 as the note editor everywhere (no collaboration yet); keep mentions, the @ picker and links working; prove it on the iPhone.
3.2 Durable Object room (y-partyserver), tickets, the Worker route; presence and cursors.
3.3 `ydoc` in the note row; `yrs` merge in row sync; saving from the room; agent edits as diffs.

## Tests

- Core: per-space cursors bring a newly joined space whole; a device drops a space it is no longer in; the server refuses a row pointing at a project, parent or assignee in another space; a project move re-homes its tasks, subtasks and notes and an offline edit cannot move one back; ties broken by server time; two `ydoc` versions merge without losing either side's text (recorded edit sequences).
- Server: every endpoint refuses another account's space ids with "not found"; owner-only operations; invite token single use, expiry, wrong email, revoke, resend, limits; accepting creates the membership in one step.
- Interface: the picker scopes every view; All shows the right tasks; assignee shows where it should and not on personal tasks; `+name` in quick add.
- Live notes: two editors converge; cursors and presence appear and leave; an agent's update made while someone types keeps both.

## Verification

Each phase: the checks in AGENTS.md, a browser preview on copies of the owner's data, and — for phases 1–3 — a real two-account test (the owner and a second Google account) on thedone.app's staging route or a second Cloud Run service. Phase 3 needs the iPhone build on a device before merge.
Not verifiable here: email delivery to Geart's real inbox until Resend is set up with the domain (owner action: Cloudflare and Resend accounts).

## Costs at this size

Neon free → a few dollars a month once in real use; Resend free; Cloudflare Workers Paid $5/month (phase 3 only); Cloud Run unchanged. Idle: about $5/month from phase 3, about $0 before.

## Risks

1. A leak between spaces through a client-sent `space_id` or reference — prevented only by the server owning the space and checking every reference; the most important tests.
2. Removal is best effort on devices that are offline or tampered with.
3. Lost edits under row last-write-wins between two people, and projects "moving back" — handled by server time and server-owned spaces; per-field merge if it bites.
4. Two sources of truth for live notes (the room and the row) — Cloud Run's merged `ydoc` is the authority; tested with recorded sequences.
5. CodeMirror in the iPhone's web view (keyboard, selection, autocorrect) — proven alone in 3.1 before any collaboration.
6. Neon cold start on top of Cloud Run's, and the free quota stopping the database — move to the paid plan once the team relies on it.

## Out of scope

Billing, more than two roles, guests outside a workspace, sharing a single task or note, comments and notifications, an activity log, a web page per workspace, Android, Google Workspace domain sign-up.

## Sources

Storage and sync: https://neon.com/pricing · https://supabase.com/pricing · https://docs.cloud.google.com/storage/quotas · https://docs.powersync.com/sync/streams/overview · https://docs.powersync.com/client-sdks/reference/rust · https://electric-sql.com/docs/guides/auth · https://zero.rocicorp.dev/docs/when-to-use · https://doc.replicache.dev/strategies/row-version · https://linear.app/now/rebuilding-delta-sync-read-path · https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
Assignees and workspaces: https://asana.com/resources/why-one-assignee · https://todoist.com/help/articles/move-a-personal-project-to-a-team-workspace-B2boCmG9C · https://linear.app/docs/workspaces · https://www.notion.com/help/navigate-with-the-sidebar
Live notes: https://docs.rs/yrs/latest/yrs/ · https://github.com/yjs/y-codemirror.next · https://codemirror.net/docs/guide/ · https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md · https://developers.cloudflare.com/durable-objects/platform/pricing/ · https://docs.cloud.google.com/run/docs/triggering/websockets · https://tiptap.dev/docs/editor/markdown
Email: https://resend.com/pricing · https://resend.com/docs/dashboard/domains/cloudflare · https://docs.rs/resend-rs/latest/resend_rs/ · https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html · https://developers.google.com/identity/openid-connect/openid-connect
