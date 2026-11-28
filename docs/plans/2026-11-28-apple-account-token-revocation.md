# Revoke Apple grants when a Done account is deleted

Issue #130. The iOS native sheet currently returns Apple's identity token and user identifier. The server verifies the token against Apple's published keys and opens a Done session. It has no token it can use at Apple's revocation endpoint. The existing credential watcher handles the opposite direction, when Apple ends a credential.

## Sign-in

Pass the authorization code from the same native credential as the identity token. Verify the device token as before. Exchange the single-use code at Apple's token endpoint with an ES256 client secret, then verify the returned identity token has the same subject, issuer and app audience. Issue the session after saving the refresh token. Token storage belongs in the transaction that creates or updates the account. Preserve distinct grants and deduplicate repetitions.

Use authenticated encryption with a random nonce, the cookie key's existing encryption half, and the account ID as associated data. Keep credentials out of responses, logs, the app's task data and its browser storage. The server's normal session remains the only credential Done returns to the client.

Code-less clients already released can still use the existing verified identity-token path. A current client sending a code must complete its exchange. Existing users that only have a legacy session keep their current session and its local Apple credential watcher.

## Deletion

Check the authenticated account generation. Revoke all retained grants for that account and delete the grants with the account, under the same serialization used for account creation and deletion. If Apple is temporarily unreachable, leave the account and its grant available for retry and tell the app it can retry. Revoking a previously revoked token is safe to retry. Account deletion without a stored grant still succeeds, including legacy Apple accounts. Keep the Apple Account instructions available for those installations.

## Checks and delivery

- Drive hosted sign-in, token exchange and account deletion against a local Apple stand-in and disposable Postgres. Check client authentication, matched identities, refusal and retry, grant deduplication, and continued legacy behavior.
- Run UI checks and Swift compiler validation around the native bridge. Share the build cache and serialize Cargo.
- Configure the hosted service through its existing deployment owner. The settings are `DONE_APPLE_TEAM_ID`, `DONE_APPLE_KEY_ID`, `DONE_APPLE_PRIVATE_KEY` (multiline PEM), and the existing `DONE_APPLE_AUDIENCE` (the native bundle ID). Keep the same DONE_SESSION_KEY while grants encrypted under it exist. The operator validates real Apple sign-in and deletion on an explicitly disposable account.
- Official Apple references are [TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple) and [token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).

## Verified on the branch

The native Swift files typechecked against the installed iPhoneOS SDK for arm64 iOS 16.4. The UI typecheck, production build, and all 754 tests passed. The bridge test sends both native credentials and checks that only the Done session and account-bound Apple user identifier reach local storage.

All 55 hosted server tests passed on disposable Postgres databases. The local Apple stand-in verifies the ES256 client assertion signature, key ID, team, audience, app ID and lifetime. Tests cover two users, two separate grants, deduplication, encrypted persistence, provider refusal, retry, session invalidation, and grant removal. Identity-code mismatch and failed exchange create no named account. A legacy account without an Apple grant still deletes.

Server startup checks an incomplete signing configuration. An unconfigured service still supports the old identity-only client. Install all three settings before shipping the iOS client that sends a code. The owner's live Apple check remains open.
