# Clickable links in task notes

Fixes #23. Branch: `feat/note-links`. Base: `origin/main` @ 5cc0b3e. Small plan.

## Why

Notes often hold a link: a doc, a pull request, a meeting. Today they are plain text, so the link has to be
copied by hand.

## Decisions

1. **What counts as a link**: `http://` or `https://` followed by anything up to whitespace, and `www.`
   addresses (opened as `https://`). Trailing punctuation that usually ends a sentence (`.,;:!?` and an
   unmatched closing bracket or quote) is left outside the link. No markdown, no other schemes.
2. **Where**: the notes under a task on its row and under a subtask. The editor stays a plain textarea.
3. **Clicking a link opens it; clicking anywhere else on the notes still opens the editor.** The notes
   leave the row's button (a link inside a button is invalid HTML and steals the click) and sit beside the
   title in the same column, with their own click that edits.
4. **How it opens**: in the Mac and iPhone apps through the existing `open_in_browser` command (the system
   browser, not the app's window); in a browser, a new tab with `noopener`. `open_in_browser` now accepts
   any `http://` page too, still only web pages.
5. **The row keeps notes on one line**; a long link is cut like any text.

## Files

- New: `ui/src/lib/links.ts` (`linkParts`), `ui/src/lib/links.test.ts`, `ui/src/components/notes-text.tsx`.
- Changed: `ui/src/components/task-row.tsx`, `ui/src/components/subtasks.tsx`, `ui/src/lib/backend.ts`
  (`openLink`), `crates/app/src/lib.rs` (`open_in_browser` accepts `http://`).

## Tests

`linkParts`: plain text, one link, two links, `www.`, trailing period and bracket, a bracketed link, text
with no scheme (`done.app`) stays text.

## Verification

`npm test`, `npm run build`, `cargo check -p done-app`, and the web interface opened locally with a task
whose notes hold two links: link opens, the rest opens the editor.

## Execution notes

- Plan vs built: all five decisions MATCH.
- Verified: `npm test` (405, six new), `npm run build`, `cargo check -p done-app`, and the web interface on a
  scratch tasks file: a task with `https://example.com/deck` and `www.example.org/notes.` shows two links,
  the full stop outside; clicking the `www.` link opened `https://www.example.org/notes` in a new tab with
  the editor closed; clicking the plain words opened the editor.
- Not verified here: the link in the Mac and iPhone apps (it goes through `open_in_browser`, already used by
  sign-in). Checked once the release is installed.
