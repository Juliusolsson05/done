# iOS required-reason APIs

Issue #91. The previous app's executable imports stat, fstat, lstat, statfs and fstatfs. The first three are used for files inside the app container. The bundled SQLite copy checks filesystem type and mount flags for locking with the last two calls and does not check free disk space. The widget executable imported none of these.

Use Apple's system SQLite on iOS, keep bundled SQLite elsewhere, and put the sandbox file metadata reason C617.1 in the app bundle. Check Xcode's copy resources phase, target-specific Cargo features, and the executable and extension from the final archive. Test core storage and iOS device/simulator build.
