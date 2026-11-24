# Notes: link a note from another note

Branch `feat/note-links` · Worktree `../done-wt/note-links` · Base `origin/main` @ 725bf91 · Issue #72
Status: built; `tsc -b`, vitest and `cargo test -p done-mcp` green; not yet seen in the running app.

## Problem

A note can mention a task (`[Call the bank](done:task/<id>)`, `lib/mentions.ts`), but not another note.
Notes that belong together (a plan and its meeting notes, a hub note and its parts) can only be tied by
copying a title by hand, which neither opens the other note nor follows a rename.

## Evidence (read from the code on 725bf91)

- Task mentions are plain Markdown links. The editor draws them as atoms (`components/mention-atoms.ts`,
  always, also on the cursor's line); the live preview leaves a `done:task/` link alone so the atom owns it
  (`lib/live-preview.ts` `MENTION_URL`). The read view swaps the `a` override (`NoteLink` in `notes.tsx`).
- The `@` picker lives in `NoteEditor` (`atQuery`, `suggestions`, `insertMention`, `MentionPicker`). The
  phone's writing bar only types an `@`, so the same picker serves Mac and phone.
- A workspace note is a Yjs `Y.Text`; the server stores its text. Plain Markdown is the only storage.
- `crates/mcp` lists a note's mentioned tasks (`mentions_in`, `describe_note` → `tasks`) and documents the
  `done:task/` form in `add_note`/`update_note`. The server (`crates/server`) does nothing with them.
- Following a note from elsewhere goes through `openView({ kind: 'notes', id })`; within Notes, note to
  note replaces the view rather than adding a back step (`lib/view-history.ts`).

## Behavior

1. **Storage**: `[Title](done:note/<id>)`, the label escaped exactly as a task mention's.
2. **Picker**: `@` offers tasks and notes in one list, in two groups (Tasks, then Notes). Notes match by
   title (prefix first, then a word that starts with the query, then all words; newest first within each);
   with nothing typed, the newest notes. The note being written and blank notes are never offered. Arrow
   keys, Enter/Tab and a tap choose from the one combined list.
3. **Editor**: a note link is one atom (as a task mention is): a note icon and the linked note's current
   title, looked up by id. A note that no longer exists shows the stored label greyed and struck through,
   with a "missing" tooltip. A click or tap opens the linked note.
4. **Read view**: a note link is a small tappable chip with the same look and the same missing state.
5. **Opening**: the Notes page opens that note (under All notes, search cleared, as a search hit does);
   on a phone the note replaces the open one, and back goes to the list as before.
6. **MCP**: a described note also lists the notes it links (`notes: [{ id, title }]`, or
   `{ id, found: false }` for one deleted); the tool descriptions mention `[title](done:note/<id>)`.
7. **Backlinks**: above the note while writing, "Linked from" chips for notes that link to it.

## Decisions (defaults taken; the owner can overturn)

1. **Same syntax family as tasks, separate scheme** (`done:note/`): readable anywhere, no parser of our own.
2. **Notes in the picker: at most 3**, the tasks fill the rest of the existing 8 rows. Keeps the list short
   above a phone keyboard; tasks stay first because the `@` was built for them.
3. **Always an atom, also on the cursor's line**, as task mentions are: half a link is neither readable
   nor a link. Editing the label means deleting and re-picking (the title shown is the live one anyway).
4. **A plain click opens the note** (not Cmd-click): the chip is a button-like thing, like the read
   view's. The caret goes beside it with the arrow keys or a tap next to it.
5. **Title lookup over every stored note**, not only the current space's, so a link to a note in another
   space still shows its title; opening one outside the current space says where it is instead of failing.
6. **Read view: always the inline chip**, never a card: a note can be long; its title is what identifies it.
7. **Backlinks shown only while writing**, in the refs row, not folded with tasks and links.

## Verification

- Unit tests (vitest) for the link helpers (parse, escape, code skipped, ranges by kind, titles without the
  syntax) and for note suggestions (ranking, exclusion of the current and blank notes).
- Read-view render test: a note link drawn as a chip with the current title; a missing one as its label.
- Live preview test: a note link is left to its widget.
- MCP test: a note lists the notes it links, a deleted one as `found: false`.
- Each new test checked to fail without the change. `npx tsc -b`, `npx vitest run`, `cargo test -p done-mcp`.
- Not verified here: the running app (no browser in this lane). Owner checks on Mac and phone.
