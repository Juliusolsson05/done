# Install and use done on Windows

The current release workflow publishes an Apple silicon app only. The shared Tauri shell has no Windows bundle target. Ship a per-user Windows installer, use the same local database across the desktop app and MCP, support the native sign-in callback, and expose the download and appropriate keyboard hints. Keep macOS and mobile behavior intact.

Build on a real Windows runner. Install into a clean profile, launch the packaged WebView, exercise task and note persistence across relaunch, and check the packaged update path. Verify the landing and Settings links, run the shared checks, and make the installer available for owner preview before merge.

## Verification on the Windows runner

The `installer` check (`.github/workflows/windows.yml`, `.github/scripts/test-windows-installer.ps1`, `ui/checks/windows-installed.cjs`) runs on a clean `windows-2022` runner with the real NSIS installer built in the same job:

1. Silent per-user install (`/S`); the `done://` handler points at an `.exe` under `%LOCALAPPDATA%`, and the data folder `%LOCALAPPDATA%\dev.done.app` is not inside the install folder.
2. The installed app launches; its WebView2 is driven over CDP. A task is added with Q, closed with Escape, and read back through the installed `done mcp`. A note is made in Notes (8, New note) and read back the same way. The MCP then edits both.
3. The app is killed, the installer is run again over it, and the app is relaunched: the window shows the edited task and the note, and the MCP reads the edited Markdown.
4. After each phase `done.db` exists in `%LOCALAPPDATA%\dev.done.app` and no `done.db*` is anywhere in the install folder.
5. Silent uninstall removes the executable (polled: an NSIS uninstaller returns before its copy in TEMP has finished) and keeps `done.db`.

Ruling: the failure in run 46101489044 was the test, not the app. Quick add stays open after Enter with the caret in its field, and the app (rightly) treats a digit typed in a field as text, so `8` went into the field and Notes never opened. Reproduced on this Mac against the same UI in Chrome: the field held "8". The test now presses Escape and waits for the field to go, as a person would. — why: changing the app would break typing digits into a task — cost if wrong: none; if Escape did not close quick add in WebView2 the check fails at that line, which is the finding we want.

Not verified on Windows by this check:

- The signed update path (an older install reading `latest.json`, downloading, verifying the signature, Restart to update, data kept). It lives on `qa/windows-signed-upgrade` (run 46101516139), which failed in its own driver before reaching the updater (`browser.contexts()[0].pages()[0]` was undefined: it attached before the page existed). Not on this branch.
- SmartScreen and the unsigned publisher: the installer is not Authenticode-signed, so a downloaded copy will warn. The runner runs it locally and never sees that prompt.
- Sign-in round trip through `done://` from a browser (only the registry entry is checked).
- ARM64 Windows: only x64 is built.
- A user closing the window (the test kills the process); the tray and focus timer.
