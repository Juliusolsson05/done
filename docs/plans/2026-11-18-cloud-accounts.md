# Done as a hosted web app: Google sign-in and one tasks file per account

Fixes #13.
Branch `feat/cloud-accounts` · Worktree `../done-wt/cloud` · Base `origin/main` @ f4a2f5e (2026-11-18)
Status: plan only. Size: standard plan. The shape is known; the choices below are real.

## Outcome

The web server gains a second way to run, chosen by `DONE_MODE=cloud`. In it, a visitor signs in with a Google account and gets a Done of their own; nothing of one account is ever sent to another. Run without that setting, the server is exactly what it is today: this Mac only, no account, one local file.

## Evidence (verified, do not re-derive)

- `crates/server/src/main.rs` is 104 lines: five routes over one `Arc<Store>`, bound to 127.0.0.1, with a middleware that refuses any Host other than localhost.
- `crates/core` is the only code touching SQLite. `Store::open(path)` makes or upgrades a file; every rule (revision check, subtasks, time sheet) lives behind `state`, `sync`, `entries`, `record`, `delete_entry`.
- The interface reaches the server only through `ui/src/lib/backend.ts`, and already recovers from a `stale` answer by loading again.
- A task file is small (the owner's, after a month of daily use, is well under 1 MB).
- A hosted container has no disk that outlives it, and more than one copy may run during a release.

## Decisions

1. **An account is a Google account.** Its id is Google's `sub` (stable for a Google account; an email can change). Nothing else about the person is stored on the server; name, email and picture ride in the session.
2. **One SQLite file per account, unchanged core.** The server opens the same `Store` per account. Alternative: one shared database with an account column on every table (every query in core changes, and one missing clause leaks another person's tasks).
3. **Where the files live is a setting.** `DONE_ACCOUNTS` is a folder, or `gs://bucket` for Google Cloud Storage. The server works on a local copy and puts the whole file back after each change.
4. **Two copies of the server never overwrite each other.** A file is put back only if the stored one is still the generation this copy started from. If it is not, the local copy is thrown away and the caller gets the same `stale` answer the interface already handles. A read checks the stored generation first, so a second copy never shows old tasks.
5. **Sign-in is the OpenID Connect code flow, written out.** Two requests with `reqwest`, about sixty lines. The id token arrives straight from Google over TLS in answer to our own request, which the OpenID Connect standard accepts in place of checking its signature; audience, issuer, expiry and "email verified" are still checked. Alternative: the `openidconnect` crate (a large dependency tree for two requests).
6. **The session is a signed cookie** (`axum-extra` signed cookies): HTTP only, Secure, SameSite=Lax, 30 days. The key comes from `DONE_SESSION_KEY`. No session table.
7. **Cross-site requests:** every changing call takes JSON only, as today, and the cookie is SameSite=Lax. The sign-in round trip carries a random `state` in a signed cookie of its own.
8. **The interface asks who it is talking to** (`GET /api/me`). In cloud mode without a session it shows a sign-in screen; with one, Settings shows the account, Sign out and Delete my account.
9. **Deleting an account deletes its file,** from the store and from this copy, and ends the session.

UNCONFIRMED: all nine are defaults chosen while the owner was away; he asked for the hosted product to be built in an unattended loop.

## Design

### Core (`crates/core`)

- `Store::snapshot(&self, to: &Path)`: writes a complete copy of the file with `VACUUM INTO`. The live file keeps its write-ahead log; a plain file copy could miss the latest change.

### Server (`crates/server`)

- `main.rs`: reads the mode and builds one of two routers. Local mode keeps today's code path.
- `accounts.rs`
  - `trait Files { get(id) -> Option<(bytes, generation)>; generation(id); put(id, bytes, if_generation) -> Result<generation, Conflict>; delete(id) }`
  - `Folder` (a directory; the generation is a counter file beside each tasks file) and `Bucket` (the Cloud Storage JSON API with `ifGenerationMatch`, token from the metadata server).
  - `Accounts`: the open stores by account id. `read(id, f)` and `write(id, f)` do the generation check, run `f` on the `Store`, and for a write put the snapshot back before answering.
- `auth.rs`: `/auth/google`, `/auth/google/callback`, `/auth/signout`, the session extractor, `/api/me`, `/api/account/delete`.
- Settings (cloud mode): `DONE_PUBLIC_URL`, `DONE_GOOGLE_CLIENT_ID`, `DONE_GOOGLE_CLIENT_SECRET`, `DONE_SESSION_KEY`, `DONE_ACCOUNTS`, `PORT`. A missing one stops the server at start with its name.

### Interface

- `backend.ts`: `loadMe()`, `signOut()`, `deleteAccount()`; a 401 from any call sends the window back to the sign-in screen.
- `components/sign-in.tsx`: the screen. `App.tsx` shows it before anything else when there is no account.
- `components/settings.tsx`: the account block, in cloud mode only.

### Invariants

- No request without a valid session reaches a tasks file.
- The account id in a request comes only from the session, never from the request.
- A file is never put back over a newer one.
- Local mode never listens beyond 127.0.0.1 and never asks for an account.

## Tests

- Core: a snapshot taken after a change opens as a store holding that change.
- Accounts (with `Folder` in a temp directory): two accounts never see each other's tasks; a write is put back and survives a restart; a second copy that writes after the first gets `stale` and then sees the first copy's change; a read after another copy's write shows it; delete removes the file.
- Auth: a request without a session gets 401 on every `/api` route; a cookie signed with another key is refused; the callback refuses a wrong `state`, a wrong audience, an expired token and an unverified email (token endpoint faked by a local listener).
- Local mode: the existing behaviour, a non-local Host still refused.
- Interface: `loadMe` shapes, and a 401 clears the account.

## Verification

- `npm run typecheck && npm test && npm run build` in `ui/`; `cargo test -p done-core -p done-mcp -p done-server`.
- Run the server in cloud mode on this Mac against a folder, with the Google token endpoint faked, and go through sign-in, add a task, sign out, sign in as a second account.
- **Verification boundary:** a real Google sign-in and a real bucket are not exercised here; they need the hosted setup, which lives outside this repository.

## Out of scope

The container image, the desktop and phone apps signing in, the MCP server against an account, sharing between accounts, offline edits.
