# Sign in with Google without leaving the iPhone app

Issue #100. On iPhone and iPad, "Sign in with Google" opens Safari (`open_in_browser`, the opener plugin) and comes back through a `done://` link. App Review rejects an app that sends people out to sign in (guideline 4.0).

## Outcome

On iPhone and iPad the hosted sign-in page opens in a sheet inside done, and the app is signed in when the sheet closes. Closing the sheet by hand leaves done usable and signed out, with no message. Mac and Windows keep opening the person's own browser, unchanged.

## Decisions

- **`ASWebAuthenticationSession`, not a web view.** Google refuses its sign-in page inside an app's own web view; the system's authentication sheet is the one in-app browser it accepts, and the one App Review expects. `callbackURLScheme: "done"`, anchored on the key window, `prefersEphemeralWebBrowserSession = false` so a Google account already signed in to Safari is offered.
- **Same bridge as Sign in with Apple.** A `@_cdecl` Swift function (`done_web_sign_in`) in `DoneNative.swift`, called from a Rust command (`web_sign_in`) that waits for one JSON answer: `{"link"}` or `{"error"}` (`"cancelled"` when the person closed the sheet). The symbol is added to `build.rs` beside the others so the iOS cdylib still links.
- **The server and the secret are untouched.** The sheet is given the same `/auth/google?app_challenge=…` address; the server's "back to the app" page moves to `done://auth?code=…`, which the session catches and returns. That link goes to the existing `finishSignIn`. The deep-link listener stays for Mac and Windows; on iOS the session takes the link before the system would deliver it, and `finishSignIn` uses the secret once in any case.
- **Rust refuses anything but `http(s)://`** before calling Swift, as `open_in_browser` does: the session raises an exception for other addresses, and the window must not be able to open them.
- **The logic that can be tested without a device lives in `ui/src/lib/cloud.ts`** (`signInInSheet`): start, read the answer, finish. `backend.ts` only picks sheet or browser.
- **`ITSAppUsesNonExemptEncryption = false`** in the app's and the widget extension's Info.plist, declared in `project.yml` (the plists are generated from it). False is right: the app's only cryptography is the system's TLS and WebCrypto SHA-256 (the sign-in challenge), both exempt.
- **AuthenticationServices** is declared in `project.yml` beside the other system frameworks. It already links today through Swift's automatic linking (`import AuthenticationServices`, Sign in with Apple ships with it), so this states what is relied on.

## Tests

- `ui/src/lib/sheet-sign-in.test.ts`: `signInInSheet` hands the sheet's link to the exchange and signs in; a closed sheet resolves false, asks the server nothing and stores no session; a failure other than closing throws.
- CI: typecheck, UI tests, UI build, `cargo test` for core, mcp, server. CI does not compile `crates/app` or any Swift.

## Rulings and what is verified

- Ruling: the Xcode project was regenerated with `xcodegen generate` (2.45.4) in the worktree, with empty `Externals` and `assets` folders standing in for the build's, and the two empty `TEMP_…` groups it then dropped were put back by hand — why: the committed project should differ by the new framework only — cost if wrong: none for a build; the next regeneration after a real build rewrites those groups anyway.
- Ruling: the "Your browser could not be opened." message moved from the settings button into `signIn` (`backend.ts`), so the button shows whichever message the platform's sign-in gives — why: the phone's failure is not about a browser — cost if wrong: a wrong sentence in a toast.
- Verified here: `DoneNative.swift` with `Shared/DoneShared.swift` type-checks against the iPhone SDK (`swiftc -typecheck`, target `arm64-apple-ios15.0`, no errors or warnings). The three plists pass `plutil -lint`. The new UI test file is formatted with Prettier.
- Verified by CI only (no `node_modules` in the worktree): typecheck, the UI tests including `ui/src/lib/sheet-sign-in.test.ts`, the UI build.

## Not verified

No device build was made (the Mac's disk is nearly full), and CI does not compile `crates/app`. Not verified: that the iOS-only Rust (`web_sign_in`) compiles and links against the Swift symbol; that the sheet appears, returns the link and signs in on a real iPhone and iPad; that closing it is silent; that Google's page offers the Safari account; that the Mac app's sign-in is unchanged in practice (its code path is the same call as before). These belong to the next device build before submission.
