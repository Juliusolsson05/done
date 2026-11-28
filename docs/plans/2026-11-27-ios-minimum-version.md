# iOS minimum version 16.4

Issue: #104. Branch: `feat/ios-minimum-version`.

## Outcome

The iPhone and iPad app only installs on iOS/iPadOS 16.4 and later, where everything the UI ships works.

## Why 16.4

- The web code uses `AbortSignal.timeout` (WebKit from iOS 16.0). On iOS 15 it throws, so every sync round fails.
- The app's CSS uses `color-mix()` (Safari 16.2) for project tints and the selection colour.
- 16.4 is the first WebKit that covers everything the UI uses. The widgets and the Live Activity already needed 16.1.

## Where the minimum is declared

| File | Before | After |
| --- | --- | --- |
| `crates/app/gen/apple/project.yml` `options.deploymentTarget.iOS` | 15.0 | 16.4 |
| `crates/app/gen/apple/project.yml` `done-widgets.deploymentTarget` | 16.1 | 16.4 |
| `project.pbxproj`, project-level debug and release (the app target inherits these) | 15.0 | 16.4 |
| `project.pbxproj`, `done-widgets` debug and release | 16.1 | 16.4 |
| `crates/app/gen/apple/Podfile` `platform :ios` | 15.0 | 16.4 |

Checked and left alone:

- `tauri.conf.json` and `tauri.ios.conf.json` have no `bundle.iOS.minimumSystemVersion`. The Xcode project is what sets it.
- The tracked `Info.plist` files (app, widgets) have no `MinimumOSVersion`. Xcode writes it at build time from the deployment target.

## Decisions

- The pbxproj is edited by hand, four lines, so nothing else in the project file moves. No `xcodegen generate`.
- The widget extension goes to 16.4 as well, so the app and its extension share one minimum.
- No refactors. These become redundant at 16.4 but stay as they are:
  - `Shared/DoneShared.swift:67` `@available(iOS 16.1, *)`
  - `Sources/done-app/DoneNative.swift:60` `#available(iOS 16.2, *)` and `:93` `@available(iOS 16.2, *)`
  - `ios-rust/prepare.py:34` pins `rusqlite` to bindings that support iOS 15's SQLite. That pin may no longer be needed at 16.4. It is a separate change.
- The `#available(iOS 17.0, *)` in `Widgets/DoneWidgets.swift` stays needed.

## Verification

- `grep -rn "15.0\|IPHONEOS_DEPLOYMENT_TARGET\|minimumSystemVersion\|MinimumOSVersion" crates/app` shows 16.4 for every target and no 15.x.
- `plutil -lint` on the Info.plists. They are not edited.
- `git diff` of the pbxproj shows only the four version lines.
- CI green on the PR head.

Not verified: an actual Xcode build or a device install. This change makes no cargo, tauri or xcodebuild build.
