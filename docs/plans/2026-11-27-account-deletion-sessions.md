# Keep deleted accounts signed out

Issue #95. A signed request currently calls the same database operation used to create an account. Separate initial sign-in from routine account lookup. Bind new accounts' sessions to a per-account generation. Existing accounts keep their previous sessions until deletion. A fresh sign-in after deletion gets a different generation. Apply the same decision to browser sessions, native tokens and connected assistants.

Exercise the hosted account lifecycle with synthetic accounts and a throwaway Postgres database. Verify ordinary sign-in and synchronization, deletion across devices, deliberate sign-in after deletion, and unaffected legacy accounts.
