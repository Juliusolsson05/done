# Revoke Apple grants when a Done account is deleted

Issue #130. The iOS native sheet currently returns Apple's identity token and user identifier. The server verifies the token against Apple's published keys and opens a Done session. It has no token it can use at Apple's revocation endpoint. The existing credential watcher handles the opposite direction, when Apple ends a credential.

The rule throughout: Apple is asked, never waited on. Neither signing in nor deleting an account ever depends on Apple answering.

## Sign-in

Pass the authorization code from the same native credential as the identity token. Verify the device token as before. Exchange the single-use code at Apple's token endpoint with an ES256 client secret, then verify the returned identity token has the same subject, issuer and app audience. Save the sealed refresh token in the transaction that creates or updates the account, then issue the session. One grant per account: the newest replaces the one before.

Any failure of the exchange is logged with its category (not configured, timed out, unreachable, or Apple's HTTP status and `error` code) and the person is signed in without a kept grant. The one refusal is Apple's id_token naming a different subject than the verified identity token.

Ruling: a failed exchange signs in, it does not refuse — a server without the settings, Apple down or slow (8 s bound), a retried single-use code (`invalid_grant`), a wrong team id or a revoked key (`invalid_client`) would otherwise lock every new iPhone sign-in out of done — cost if wrong: such an account keeps no grant, so its deletion says "none" and the app asks the person to disconnect done in their Apple Account themselves.

Code-less clients already released still use the verified identity-token path. Existing users that only have a legacy session keep their current session and its local Apple credential watcher.

## Sealing

AES-256-GCM, a random nonce, the account id and the key version as associated data. Stored as `version ‖ nonce ‖ ciphertext`. Version 1: a key derived from `DONE_SESSION_KEY` with the label `done apple grant key v1`. Version 2: a key derived from the optional `DONE_APPLE_GRANT_KEY` (at least 32 characters) with the label `done apple grant key v2`; when it is set, new grants use it and version-1 grants still open while the session key is unchanged. Unset, nothing new is required.

Ruling: no migration of earlier ciphertexts — this PR's first schema (`apple_grant`, unversioned, keyed with the cookie key) never ran in production because the PR was unmerged; the table is now `apple_refresh_grant`, so a development database with the old table is simply ignored — cost if wrong: an old row on some database is never revoked and goes with its account.

A grant that cannot be decrypted (the session key rotated without `DONE_APPLE_GRANT_KEY`, or that key removed) is reported as "not_revoked" and deleted with the account.

## Deletion

The person's deletion always wins (Apple's TN3194: the deletion request must still be fulfilled). The server reads the account's grant (checking the session generation, PR #97), asks Apple once to revoke it within the 8 s bound, and then deletes the account in its own transaction, exactly as before this PR. Nothing is locked while Apple answers. The answer is `{ "apple": "revoked" | "not_revoked" | "none" }`; "none" is no kept grant, including every non-Apple account. Older apps ignore the field.

Ruling: no retry and no blocking on a timeout or a 5xx — the owner's standing rule is "never block or loop", and errors such as a revoked key or a rotated session key never clear, which kept the account forever in the first version — cost if wrong: a grant Apple would have revoked a minute later stays at Apple; the app then tells the person to disconnect done themselves.

Ruling: revoke outside the deleting transaction — a sign-in on another device between the read and the delete replaces the grant, and the newer one goes with the account unrevoked; the account is being deleted, so that is accepted — cost if wrong: in that race, the app says "revoked" for the older grant while the newer one stays at Apple until the person disconnects done.

Failures are logged for the operator with the HTTP status and Apple's `error` code (or "timed out", "not configured", "could not be decrypted (key version n)"), never a token, code or key.

## What the app says

After the deletion the app reloads (the "deleting" and "deleted" marks of PRs #112 and #124 are unchanged; the field is read only after the server confirmed). For an Apple account, the outcome is kept in web storage and shown after the reload until closed:

- revoked: "Your account was deleted, and done disconnected Sign in with Apple."
- not_revoked, none, or an older server that says nothing: "Your account was deleted. done could not disconnect Sign in with Apple, so disconnect done yourself in your Apple Account, under Sign in with Apple." with Apple's instructions (https://support.apple.com/102571).
- not an Apple account: nothing about Apple.

Before deleting, Settings says done also disconnects Sign in with Apple and will say if the person needs to. The privacy page says the same.

## Operator handoff

Values for the hosted web service (not `collab`, which needs none of them):

- `DONE_APPLE_TEAM_ID=99MUK5B6TA` (what the app is signed with: `crates/app/gen/apple/project.yml` and the Xcode project; the portal screenshot was misread as 99MUK586TA).
- `DONE_APPLE_KEY_ID=62RDX77TQX`.
- `DONE_APPLE_PRIVATE_KEY` from Secret Manager secret `done-apple-signin-key` (project done-app-13385), with `roles/secretmanager.secretAccessor` granted to the web service's service account.
- `DONE_APPLE_AUDIENCE` stays as it is (the iOS bundle id). `DONE_APPLE_GRANT_KEY` is optional.

Order: grant the secret role, set the environment, deploy the server, and only then ship an iOS client that sends the code. During the rollout an old revision can delete an account without revoking its grant (the row cascades): acceptable.

At start-up the server signs one client secret and logs either `Apple grant revocation: configured (team …, key …, grants sealed with …)` or `Apple grant revocation: off (<reason>)`. After a deploy, confirm the configured line and the team id in it in the web service's logs. A mistyped team id signs fine but Apple refuses it: after the first Apple sign-in from the new client, look for `Apple code exchange failed: status 400, error invalid_client` (or 401), which means nothing is being kept.

## Checks and delivery

- Hosted sign-in, exchange and deletion against a local Apple stand-in and disposable Postgres: client secret signature and claims, one grant per account, sealing, revocation, other accounts' grants untouched.
- Exchange failures sign in with nothing kept: unconfigured server, 503, `invalid_grant`, `invalid_client`, an empty code, and a timeout within the bound. A mismatched subject is refused.
- Deletion succeeds and answers "not_revoked" for 503, `invalid_client`, a timeout, an undecryptable grant and removed settings; "revoked" when Apple takes it; "none" for a legacy Apple account and a Google account.
- No refresh token, code, client secret or private key in the captured log or any response body; the log carries the statuses and Apple's error codes.
- The start-up check's reasons; sealing bound to account and version, with and without `DONE_APPLE_GRANT_KEY`, and after a session-key rotation.
- UI: the three wordings, an older server's empty answer, and the deletion marks unchanged in each case.
- Official Apple references are [TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple) and [token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).

## Verified on the branch

The native Swift files typechecked against the installed iPhoneOS SDK for arm64 iOS 16.4 (first version; unchanged since). The review fixes: the new server tests fail on 3f7fbd2 (exchange failures answered 401, deletion with Apple down answered 500) and pass now; the full cargo suites (core, mcp, server) and the UI typecheck, build and tests pass. No call to Apple's real endpoints was made. The owner's live Apple check on a disposable account remains open.
