# Install and use done on Windows

The current release workflow publishes an Apple silicon app only. The shared Tauri shell has no Windows bundle target. Ship a per-user Windows installer, use the same local database across the desktop app and MCP, support the native sign-in callback, and expose the download and appropriate keyboard hints. Keep macOS and mobile behavior intact.

Build on a real Windows runner. Install into a clean profile, launch the packaged WebView, exercise task and note persistence across relaunch, and check the packaged update path. Verify the landing and Settings links, run the shared checks, and make the installer available for owner preview before merge.
