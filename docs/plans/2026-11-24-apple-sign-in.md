# Sign in with Apple and an App Review login

Fixes #79. The iPhone app goes to App Store review on 25 Nov with Google as its only sign-in.

## Decisions

- **Native Sign in with Apple on iOS only.** `ASAuthorizationController` in the app target
  (`DoneNative.swift`, `@_cdecl("done_apple_sign_in")`) hands the identity token to Rust and
  then to the window, which posts it to `POST /auth/apple`. The web keeps Google only:
  guideline 4.8 is about the app, and the web flow would need a Services ID and a key.
- **The server verifies the token itself** against Apple's published keys
  (`https://appleid.apple.com/auth/keys`, RS256): issuer, audience `app.thedone.ios`, expiry.
  No Apple secret on the server.
- **Account id**: `apple` + the first 40 hex digits of SHA-256 of Apple's `sub`. Ids become file
  names (letters and digits only) and Apple's contain dots; the prefix keeps them apart from
  Google's numeric ids.
- **Name**: Apple sends it only on the first sign-in, from the device. Later sign-ins keep the
  stored name rather than overwriting it with nothing.
- **App Review login** (`POST /auth/review`): username `review`, password from
  `DONE_REVIEW_PASSWORD` (at least 16 characters; unset means off). One fixed account. No email
  provider needed. Settings shows it behind a small "Sign in with a password" link.
- **Delete account** is already in Settings → Account and deletes everything on the server.

## Not in this PR

Revoking Apple tokens on account deletion (needs a Sign in with Apple key from the developer
portal; follow-up), Sign in with Apple on the web and the Mac app.
