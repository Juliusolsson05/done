# Keep deleted accounts signed out

Issue #95. A signed request currently calls the same database operation used to create an account. Separate initial sign-in from routine account lookup. Bind new accounts' sessions to a per-account generation. Existing accounts keep their previous sessions until deletion. A fresh sign-in after deletion gets a different generation. Apply the same decision to browser sessions, native tokens and connected assistants.

Exercise the hosted account lifecycle with synthetic accounts and a throwaway Postgres database. Verify ordinary sign-in and synchronization, deletion across devices, deliberate sign-in after deletion, and unaffected legacy accounts.

The two-device deletion regression returned HTTP 200 for the second device before the change and 401 afterwards. A real sign-in can create a fresh account. Browser, native and OAuth credentials issued to the old account cannot use the new one. Live-note connections check the generation on entry and during their existing membership checks. Reads use a consistent database snapshot, and an in-flight write and deletion are serialized on the account row. No deleted-account registry is required.

All 46 server tests passed on disposable Postgres databases, including legacy sessions, import, concurrent reads and writes, concurrent workspace-owner deletion, and live-note tickets. The Rust core and MCP suites passed as well. Deploy the same image to the web and live-notes services.
