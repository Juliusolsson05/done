# Done as an iPhone app

Fixes #19.
Branch `feat/iphone-app` · Worktree `../done-wt/ios` · Base `origin/main` @ 75ad189 (2026-11-18)
Status: plan only. Size: standard plan.

## Outcome

`crates/app` builds for iOS as well as macOS. On an iPhone it shows the same interface in its phone layout, keeps tasks on the phone with no account, and can sign in to a hosted account where it was built knowing one. The Mac app is unchanged.

## Evidence (verified 18 Nov 2026, do not re-derive)

- `crates/app` is one binary (`src/main.rs`). Tauri builds an iOS app from a library with a marked entry point, not from a binary.
- Mac-only in it today: the menu bar icon and countdown (`tray-icon`), the updater plugin, hiding the window on close, the Dock "reopen" event, the `afplay` sound, and `done mcp`.
- This Mac has Xcode 26.2, xcodegen, CocoaPods and iPhone 17 simulators. Rust's iOS targets were added for this work.
- The interface already has a phone layout (#16) and app sign-in (#18).
- `done_core::default_path()` is `$HOME/Library/Application Support/done/done.db`. On iOS `$HOME` is the app's own container, so the same path is inside the app's data.

## Decisions

1. **One crate, two shapes.** The app's code moves to `src/lib.rs` with `run()`; `src/main.rs` keeps `done mcp` and calls `run()`. Alternative: a second crate for the phone (two copies of the commands to keep in step).
2. **Mac-only parts are compiled only for the desktop** (`#[cfg(desktop)]`), not switched off at run time. The updater is a desktop-only dependency.
3. **The Xcode project is generated and committed** (`crates/app/gen/apple`), as Tauri intends, so a build does not depend on regenerating it. Signing is left to whoever builds: no team id in the repository.
4. **The bundle id stays `dev.done.app`.**
5. **No phone-only features in this change**: no notifications, widgets or Keychain.

UNCONFIRMED: all five are defaults chosen while the owner was away.

## Tests

No new logic. The existing suites must pass, and the Mac app must compile unchanged in behaviour.

## Verification

- `cargo check -p done-app` (Mac) and all test suites.
- The iOS app built for the simulator and started on an iPhone 17 simulator: it opens, shows the phone layout clear of the notch and home indicator, a task can be added and is still there after the app is restarted.
- **Verification boundary:** not installed on a real iPhone (that needs the owner's Apple developer team for signing), and sign-in is not exercised (no Google sign-in client yet).

## Out of scope

TestFlight and the App Store, Android, push notifications, a share extension.
