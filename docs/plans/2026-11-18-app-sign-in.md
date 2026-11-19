# The Mac and iPhone apps can sign in to a hosted account

Fixes #17.
Branch `feat/app-signin` · Worktree `../done-wt/app-signin` · Base `origin/main` @ 972dc75 (2026-11-18)
Status: implemented, PR open. Size: standard plan.

## Outcome

An app keeps working on its local tasks file with no account, as today. Where the app was built knowing a hosted server, Settings offers "Sign in". After signing in, the app shows the hosted account's tasks, the same ones the web app shows. Signing out brings the local file back, untouched.

## Evidence (verified, do not re-derive)

- The interface reaches tasks through `ui/src/lib/backend.ts` only: the app's own commands when `window.__TAURI__` exists, `/api` otherwise.
- The hosted server knows a person by a signed cookie (`crates/server/src/auth.rs`). An app's web view is a different origin from the server, and the cookie is SameSite=Lax, so it is never sent from there.
- Google refuses its sign-in page inside an embedded web view ("disallowed_useragent"); an app must use the system browser.
- A link with a custom scheme (`done://`) can be claimed by any app on a device.

## Decisions

1. **A token in place of the cookie.** The same signed session value, sent as `Authorization: Bearer`. The server accepts either.
2. **The round trip is done by the server, and proven by the app.** The app makes a random secret and opens the system browser at `/auth/google?app_challenge=<SHA-256 of the secret>`. After Google, the server shows a page that hands `done://auth?code=…` to the app. The app posts the code and the secret to `/auth/exchange` and gets its token. A code is signed, lasts two minutes, and is worth nothing without the secret, so another app claiming `done://` gains nothing. The server stores nothing, so any copy of it can finish what another started.
3. **Cross-origin answers only for the apps.** `/api` and `/auth/exchange` answer the origins a Tauri web view has (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`). No other origin, and no credentials mode: a cookie is never accepted from another origin.
4. **Which server is a build setting**, `VITE_DONE_CLOUD_URL`. Absent, the app has no sign-in and is what it was.
5. **The token is kept in the web view's own storage.** Alternative: the Keychain, through a plugin (better, and a later change; the token can be revoked only by changing the server's key either way).
6. **Signed in, every task call goes to the server; signed out, to the local file.** No merging of the two. The MCP server keeps reading the local file.

UNCONFIRMED: all six are defaults chosen while the owner was away.

## Design

### Server (`crates/server/src/auth.rs`, `main.rs`)

- `seal` / `unseal`: sign and check a text with the session key (the `cookie` crate's signed jar, the same signing the cookie has).
- `Session` extractor: bearer first, then the cookie.
- `/auth/google?app_challenge=`: the challenge rides in the signed "signing in" cookie beside the random word.
- `/auth/google/callback`: with a challenge, answers a small page that opens `done://auth?code=…` instead of setting the session cookie.
- `POST /auth/exchange { code, verifier }` gives `{ token, account }`.
- CORS as in decision 3.

### App (`crates/app`)

- Plugins: deep link (`done://`), and opening a link in the system browser.
- No new commands: the interface listens for the link.

### Interface

- `lib/cloud.ts`: the token and account in storage, starting a sign-in (secret, challenge, open the browser), finishing one (exchange), signing out.
- `backend.ts`: a third way to reach tasks, chosen when the app is signed in.
- Settings: Sign in, or the account with Sign out, in an app built with a server.

### Invariants

- A code is never accepted as a token, nor a token as a code.
- A code without its secret gives nothing.
- A request from another origin is never answered on a cookie.

## Tests

- Server: the whole round trip with a real listener (challenge, page with the link, exchange, a task saved and read with the token); a wrong secret, an expired code, a token offered as a code and a code offered as a token are all refused; a preflight from the app's origin is allowed and from another origin is not; the browser round trip without a challenge still sets the cookie.
- Interface: the challenge is the SHA-256 of the secret in the form the server checks; reading the link; storage that is not available.

## Verification

- All test suites. The Mac app built and run against the server in cloud mode on this Mac, as far as the Google page.
- **Verification boundary:** the round trip through real Google needs the sign-in client, which does not exist yet.

## Out of scope

The Keychain, offline edits while signed in, moving local tasks into an account, the MCP server against an account.

## Execution notes

- Plan vs built: all six decisions MATCH.
- Ruling: the app has one new command, `open_in_browser`, where the plan said none. Opening the browser from the interface would need the plugin's script and a permission for it; one command that only opens web pages is smaller and says what it allows. The link coming back is passed to the window as an `opened-link` event.
- Ruling: after Google, the browser is shown a page with an "Open done" button that also tries the link by itself, not a bare redirect. A browser does not follow a redirect to an app's own kind of link without asking, and some never do.
- Ruling: signing in or out reloads the window. Which way tasks are reached is decided once when the window loads, so no part of the interface can be left looking at the other set of tasks.
- Ruling: the release workflow reads the server's address from the repository variable `DONE_CLOUD_URL`. Until it is set, released apps have no sign-in.
- Verified: `npm run typecheck`, 399 interface tests, `npm run build`; `cargo test -p done-core -p done-mcp -p done-server` (server 16); `cargo check -p done-app`. Fail-first: dropping the check of the secret fails `a_code_is_worth_nothing_without_the_secret_and_is_never_a_token`.
- Not run here: the round trip through real Google, and the `done://` link reaching a built app. Both need the Google sign-in client, which does not exist yet; they are checked when the hosted service is first deployed.
- Not done: the `pr-review` round by other agents.
