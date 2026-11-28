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

## The download a browser visitor sees

Owner request: the landing page (`crates/server/src/feedback.html`, hi.thedone.app) and Settings in the web app offer the download for the visitor's own system, with the others as small links underneath.

- The rule is one pure pair in `ui/src/lib/platform.ts`: `detectPlatform(userAgent, platform, maxTouchPoints, userAgentData?)` gives `windows | mac | ios | android | linux | other` and the chip when Chromium's `getHighEntropyValues(['architecture'])` says it; `downloadOffer` turns that into one primary, an optional note and the other downloads. Tested with real user agents (Windows 11 Chrome, Edge, Firefox; macOS Safari, Chrome; iPadOS desktop mode; iPhone; Android Chrome; Linux Firefox; ChromeOS) in `platform.test.ts`.
- The landing page cannot import the interface, so it keeps an inline copy of the same rule, with a comment naming `platform.ts` as the tested source. Its HTML lists all three options as plain links; the script only promotes one. Nothing read leaves the page.

| Visitor | Primary | Note | Also for |
| --- | --- | --- | --- |
| Windows (x64, or chip unknown) | Download for Windows | none | Mac (Apple silicon) |
| Windows, Chromium says ARM | Open done in your browser | There is no build for Windows on ARM yet. | Windows (x64) · Mac (Apple silicon) |
| Mac, Apple silicon or chip unknown (Safari) | Download for Mac | For Macs with Apple silicon. | Windows (x64) |
| Mac, Chromium says Intel | Open done in your browser | The Mac app needs Apple silicon, and this Mac has an Intel chip. | Mac (Apple silicon) · Windows (x64) |
| iPhone, iPad (also in desktop mode) | Use done in the browser | none (no App Store link: the app is not there yet) | Mac (Apple silicon) · Windows (x64) |
| Android, Linux, ChromeOS, unknown | Open done in your browser | none | Mac (Apple silicon) · Windows (x64) |

In Settings, which already is done in the browser, the browser case is a sentence instead of a button. Settings is not shown this pane inside an app.

Ruling: Windows on ARM gets the browser, not the x64 installer. — why: nobody has run the x64 build or its WebView2 under emulation on an ARM PC, so recommending it would be a guess — cost if wrong: an ARM user who could have used the x64 build is pointed to the browser, with the x64 link still one click away.

Ruling: a Mac that Chromium reports as Intel is pointed to the browser, with the Mac link still there. Safari always says "Intel Mac OS X", so there the chip is never claimed and the Mac download stays primary with "For Macs with Apple silicon." — why: the build is arm64 only — cost if wrong: none; the link is never hidden.

Verified: in Chrome on this Mac with emulated user agents, `navigator.platform`, `maxTouchPoints` and `userAgentData` (Windows x64, Windows ARM, Mac Safari, Intel Mac Chrome, iPhone, iPad desktop mode, Android, Linux Firefox), for the landing page (the template with `{{APP_URL}}` filled in, served statically) and for Settings (this branch's interface in Vite against a prebuilt local server on a scratch database). The landing page with JavaScript off shows all three plain links. Not verified: on real devices; the landing page as served by a server built from this branch (no local cargo builds).

## What a release from this branch would publish

`release.yml` runs only on `main` (the `plan` job), so nothing is published from this branch until it is merged. Then `gh workflow run release.yml` (or the nightly schedule) builds the Mac (`macos-latest`) and Windows (`windows-2025`) apps as two separate jobs of one matrix, `fail-fast: false`, and a `publish` job makes release `v0.1.<commits on main>`:

- Mac, always as today: `done-mac-arm64.zip`, `done.app.tar.gz`, `done.app.tar.gz.sig`, and the `darwin-aarch64` entry in `latest.json`. Without all three files nothing is published, as today when the Mac build fails.
- Windows, when its build succeeded: `done-windows-x64-setup.exe`, `done-windows-x64-setup.exe.sig`, and the `windows-x86_64` entry in `latest.json`. The links use `releases/latest/download/done-windows-x64-setup.exe`, which matches.
- The release is created as a draft, every file is uploaded, and only then is it published and marked latest (`gh release edit --draft=false --latest`). Installed apps read `latest.json` of the latest release, so they never see a half-uploaded one.

Ruling: a failed Windows build no longer holds back the Mac release. — why: `publish` needed the whole `build` matrix to succeed, so one failed Windows job skipped `publish`, and Mac apps got no update until Windows was fixed. The updater itself never broke (the previous release stayed latest), but the Mac stopped getting releases. Now `publish` runs `if: always()` after a successful `plan`, requires the Mac files, and leaves `windows-x86_64` out of `latest.json` when the Windows files are missing. Installed Windows apps then find no entry for their platform, log it and check again in six hours. So the download link does not 404 for that release, the previous latest release's installer (without its `.sig`, so it is never offered as an update) is carried over. The workflow run still shows the Windows job as failed. — cost if wrong: a release whose Windows download is one version behind until the next release, which the app then updates itself to.

The Mac link (`releases/download/mac/Done.dmg`) is not made by this workflow; it is the notarized disk image done-infra puts on the release `mac`. The first release after merge must be published before the server with the new landing page is deployed, or the Windows link answers 404.

Verified: the workflow parses as YAML; the publish script passes `bash -n`, and a dry run with a stub `gh` produced a `latest.json` with both entries when both builds' files were present, and only `darwin-aarch64` (with no Windows files uploaded) when the Windows files were missing. Not verified: the workflow on GitHub (it has never run from this branch; the Windows job on `windows-2025` with bash and `jq`; the signing secret; `gh release download` of the carried-over installer).
