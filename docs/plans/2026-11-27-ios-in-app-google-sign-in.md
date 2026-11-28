# Sign in with Google without leaving the iPhone app

Issue #100. On iPhone and iPad, "Sign in with Google" opens Safari (`open_in_browser`, the opener plugin) and comes back through a `done://` link. App Review rejects an app that sends people out to sign in (guideline 4.0).

## Outcome

On iPhone and iPad the hosted sign-in page opens in a sheet inside done, and the app is signed in when the sheet closes. Closing the sheet by hand leaves done usable and signed out, with no message. Mac and Windows keep opening the person's own browser, unchanged.

## Decisions

- **`ASWebAuthenticationSession`, not a web view.** Google refuses its sign-in page inside an app's own web view; the system's authentication sheet is the one in-app browser it accepts, and the one App Review expects. `callbackURLScheme: "done"`, anchored on the key window, `prefersEphemeralWebBrowserSession = false` so a Google account already signed in to Safari is offered.
- **Same bridge as Sign in with Apple.** A `@_cdecl` Swift function (`done_web_sign_in`) in `DoneNative.swift`, called from a Rust command (`web_sign_in`) that waits for one JSON answer: `{"link"}` or `{"error"}` (`"cancelled"` when the person closed the sheet). The symbol is added to `build.rs` beside the others so the iOS cdylib still links.
- **The server and the secret are untouched.** The sheet is given the same `/auth/google?app_challenge=…` address; the server's "back to the app" page moves to `done://auth?code=…`, which the session catches and returns. That link goes to the existing `finishSignIn`. The deep-link listener stays for Mac and Windows; on iOS the session takes the link before the system would deliver it, and `finishSignIn` uses the secret once in any case.
- **The sheet shows the sign-in page only.** Rust refuses anything but an `http(s)://` address whose path ends in `/auth/google` before calling Swift (the session raises an exception for other kinds of address). The interface checks the rest, that the address is the hosted server's (`isSignInPage`), before asking for the sheet.
- **The logic that can be tested without a device lives in `ui/src/lib/cloud.ts`**: `signInFromApp` picks sheet or browser, `signInInSheet` starts, reads the answer and finishes. `backend.ts` only supplies the two native calls.
- **One sign-in at a time.** `signIn` in `backend.ts` gives a second tap the promise of the sign-in already under way.
- **`ITSAppUsesNonExemptEncryption = false`** in the app's and the widget extension's Info.plist, declared in `project.yml` (the plists are generated from it). False is right: the app's only cryptography is the system's TLS and WebCrypto SHA-256 (the sign-in challenge), both exempt.
- **AuthenticationServices** is declared in `project.yml` beside the other system frameworks. It already links today through Swift's automatic linking (`import AuthenticationServices`, Sign in with Apple ships with it), so this states what is relied on.

## Tests

- `ui/src/lib/sheet-sign-in.test.ts`: `signInFromApp` uses the sheet and never the browser on iOS, and the browser elsewhere (this fails if the phone is routed to the browser again); `isSignInPage` passes only the hosted server's page; a second `signIn` while one is under way returns the same promise and shows one sheet. `signInInSheet` hands the sheet's link to the exchange and signs in; a closed sheet resolves false, asks the server nothing and stores no session; a failure other than closing throws.
- CI: typecheck, UI tests, UI build, `cargo test` for core, mcp, server. CI does not compile `crates/app` or any Swift.

## Rulings and what is verified

- Ruling: the Xcode project was regenerated with `xcodegen generate` (2.45.4) in the worktree, with empty `Externals` and `assets` folders standing in for the build's, and the two empty `TEMP_…` groups it then dropped were put back by hand — why: the committed project should differ by the new framework only — cost if wrong: none for a build; the next regeneration after a real build rewrites those groups anyway.
- Ruling: the "Your browser could not be opened." message moved from the settings button into `signIn` (`backend.ts`), so the button shows whichever message the platform's sign-in gives — why: the phone's failure is not about a browser — cost if wrong: a wrong sentence in a toast.
- Ruling (review of #101): the server's address is checked in the interface, not in Rust — why: Rust cannot know it. `VITE_DONE_CLOUD_URL` is given to the interface's build; the iPhone app's Rust is compiled by Xcode's build step, which does not reliably carry that variable, so a compiled-in check would either be absent or refuse every sign-in in a shipped build. Rust checks what it can without it (web address, sign-in path) — cost if wrong: script already running in the app's own window could show another site's `/auth/google` page in the system sheet, which has its own address bar and shares nothing with the app.
- Ruling (review of #101): a non-`Error` rejection (Tauri rejects with a string) shows "Signing in did not work. Try again." in the settings button instead of "undefined".
- Verified by the reviewer on the first head (e568ad0): `cargo check -p done-app --target aarch64-apple-ios` passes. The Rust changed since (the address check in `web_sign_in`) has not been compiled.
- Verified here: `DoneNative.swift` with `Shared/DoneShared.swift` type-checks against the iPhone SDK (`swiftc -typecheck`, target `arm64-apple-ios15.0`, no errors or warnings). The three plists pass `plutil -lint`. The new UI test file is formatted with Prettier.
- Verified by CI only (no `node_modules` in the worktree): typecheck, the UI tests including `ui/src/lib/sheet-sign-in.test.ts`, the UI build.

## Not verified

No device build was made (the Mac's disk is nearly full), and CI does not compile `crates/app`. Not verified: that the iOS-only Rust (`web_sign_in`) links against the Swift symbol in an app build, or compiles with its latest address check; that the sheet appears, returns the link and signs in on a real iPhone and iPad; that closing it is silent; that Google's page offers the Safari account; that the Mac app's sign-in is unchanged in practice (its code path is the same call as before). These belong to the next device build before submission.
