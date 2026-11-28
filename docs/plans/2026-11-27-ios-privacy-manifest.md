# iOS required-reason APIs

Issue #91. The previous app's executable imports stat, fstat, lstat, statfs and fstatfs. The first three are used for files inside the app container. The bundled SQLite copy checks filesystem type and mount flags for locking with the last two calls and does not check free disk space. The widget executable imported none of these.

Use Apple's system SQLite on iOS, keep bundled SQLite elsewhere, and put the sandbox file metadata reason C617.1 in the app bundle. Check Xcode's copy resources phase, target-specific Cargo features, and the executable and extension from the final archive. Test core storage and iOS device/simulator build.

## Ruling and verification

The root workspace keeps its original bundled SQLite 3.54.1 and rusqlite 0.42.0. Changing all targets to rusqlite 0.40 would bundle SQLite 3.53.2 on Mac and server, a version affected by RUSTSEC-2026-0459. Xcode instead stages a workspace under its target temporary directory, reuses the original source and Tauri project, and selects rusqlite 0.40.2 without bundled SQLite. These bindings support the older system libraries on iOS 15. The SQLite-specific lockfile differences are applied to the root lock during staging. If a future shared dependency update conflicts with the overlay, regenerate the delta from the isolated lock. The widget extension had no required-reason API imports.

A fresh and repeated staging pass produced identical lockfiles. Cargo verified the iOS dependency graph offline with its lock enforced. All 33 core and 13 MCP tests passed with SQLite 3.34.1 loaded, confirmed by dyld. Plutil validated the manifest. A signed device archive with this SQLite linkage contained the manifest and imported the system SQLite library without statfs or fstatfs. Verification of the staged Xcode prebuild and final submission archive belongs to the App Store release.
