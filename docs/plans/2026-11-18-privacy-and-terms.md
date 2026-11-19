# A privacy page and a terms page for the hosted web app

Fixes #21.
Branch `feat/privacy-terms` · Worktree `../done-wt/pages` · Base `origin/main` @ 2ff894d (2026-11-18)
Status: plan only. Size: small plan.

## Outcome

The hosted server answers `/privacy` and `/terms` to anyone, signed in or not, and the sign-in screen links to both. The local server has neither: it has no accounts and keeps nothing about anyone.

## Decisions

1. **The pages say what the code does, and nothing else.** What is kept (the Google account's id, name, email and picture in the session; the tasks file), where, for how long, and how to delete it. Every sentence can be checked against `crates/server`.
2. **Who runs the server is a setting**, `DONE_OPERATOR` and `DONE_CONTACT`, shown on both pages. Someone else hosting this code is a different operator. Without them the pages say "the operator of this server" and give no contact.
3. **Plain pages built into the server**, like the page that hands a sign-in back to an app. No second build.
4. **The terms are short and plain.** They are a starting point written by the developer, not legal advice.

UNCONFIRMED: the wording of both pages is the owner's to approve before the service is opened to the public.

## Tests

Both pages answer without a session and name the operator from the settings; the local server answers neither.

## Verification

`cargo test -p done-server`, the interface suite, and the two pages read in a browser.
