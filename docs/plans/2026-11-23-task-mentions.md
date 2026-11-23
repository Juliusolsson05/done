# Notes: mention tasks with @

Fixes #43.
Branch `feat/task-mentions` · Worktree `../done-wt/task-mentions` · Base `origin/main` @ eaa7061 (2026-11-23)
Status: building with the defaults below; the owner sees a browser preview before merging. Size: standard plan.

## Outcome

In a note, typing `@` and a few letters offers matching tasks; picking one puts the task in the note. Reading the note shows each mentioned task as the task itself — a round check, its current title, its due date and project — so a note such as "Goals and milestones for next week" bundles live tasks between its own headings and words. Ticking the check finishes the task; the title takes you to it.

## Evidence (verified, do not re-derive)

- Notes are written in a plain `<textarea>` and read through markdown-to-jsx 9.10.6 (`ui/src/components/notes.tsx`, `MARKDOWN` options: raw HTML off, `forceBlock`, `wrapper: Fragment`, override `a: NoteLink`).
- Rendered with those exact options (probe, 2026-11-23): `[Call the bank](done:task/1795306779859023)` reaches the `a` override with `href="done:task/1795306779859023"` inside a list item, a paragraph, a table cell and after a `[ ]` checklist box; `` `[x](done:task/3)` `` in a code span and the same in a fenced block stay text; an escaped `\]` in the label is unescaped by the parser; `javascript:` and `data:` hrefs arrive as `undefined` (the library's own sanitizer).
- The window holds open tasks and those finished today (`state`); older finished tasks come from `loadFinished()` (the Completed page).
- `App.reveal({ kind: 'task', id })` (used by search) shows a task in its list and marks it; `complete(id)` and `reopen(id)` finish and reopen with their sounds.
- The owner's warning: an earlier project mixed Markdown rendering with custom rendering and it went badly.

## Decisions

1. **What is stored** — *Default: an ordinary Markdown link, `[title](done:task/<id>)`.* The Markdown parser finds it like any link; the renderer only changes how its own link element is drawn. No second parser runs over the text, nothing is rewritten before Markdown sees it, and the note stays readable as plain text on every device, in older versions, and over MCP. Alternative: a custom token such as `@[title](id)`, which would need its own pass over the text before or after Markdown — the mixing that went wrong before.
2. **How a mention reads** — first built as a small inline chip (check, title, date, dot); **changed 2026-11-23 at the owner's request ("a little bit more comprehensive")** to a card: the check in its priority colour, the title (a star if it is today's goal), and under it the project, the date in words (a start–due span; "Late · 18 Nov" in red; "Done today" when finished), subtasks done of total, "In progress", and how its notes begin. Still one element made of spans, so it needs no knowledge of where in the Markdown it sits (list, sentence, table). The title is the task's current one; the link text is only the fallback.
3. **Ticking in a note** — finishes (or reopens) the task, the same as ticking it in a list. **Extended 2026-11-23 at the owner's request ("fully interactive … completing and expanding subtasks"):** the card shows the task's whole description (links clickable), and its subtask count opens and closes the subtasks, each with its own check and description. Open or closed is the same state as in the lists (`lib/expanded`).
4. **Writing** — *Default: the editor stays a plain textarea.* The link text is visible while writing; above it, the mentioned tasks show as chips (as web links already do). A rich editor that hides the syntax is out of scope — it is the riskier road.
5. **The @ picker** — *Default: `@` at the start of a line or after a space or an opening bracket* (so `name@mail.com` never opens it), then letters; matching open tasks, best first, ↑/↓, Enter or Tab, Esc. Subtasks are not offered.
6. **A task finished earlier, or deleted** — *Default:* finished: shown ticked, title struck through (fetched from the Completed list when needed). Deleted: the title the link carries, greyed, no check.
7. **MCP** — *Default:* each note lists the tasks it mentions (id, title, done); tool descriptions explain the syntax so an agent can write mentions too.

Answered 2026-11-23: the owner asked to build it following the conventions and test it in the browser; decisions are defaults and **UNCONFIRMED** until the preview.

## Design

- `ui/src/lib/mentions.ts` (pure, tested): `mentionHref(id)`, `mentionId(href): number | null` (only `done:task/<digits>`), `mentionLink(task)` (escapes `\ [ ]` in the title), `mentionsIn(text): number[]` (ids in order, once each, skipping code spans and fenced blocks), `withoutMentionSyntax(text)` (a mention becomes its label: for titles), `atQuery(text, caret)` (the `@` being typed: start and query, or null), `insertMention(text, start, caret, task)` (new text and caret), `suggestions(tasks, query)`.
- `ui/src/lib/notes.ts`: `titleOf` reads a mention as its label.
- `ui/src/components/task-mention.tsx`: `TaskMention` (Read mode), `MentionChips` (writing), `MentionPicker` (the list under the caret; caret position measured with a mirror element of the textarea).
- `notes.tsx`: the `a` override hands `done:task` links to `TaskMention`, everything else to `NoteLink` as before; `NoteText` gains the picker and the chips.
- `crates/mcp`: `describe_note` adds `tasks`; `add_note` / `update_note` descriptions give the syntax.

Invariants: the Markdown options other than the `a` override are unchanged; nothing transforms note text before rendering except the existing `keepLineBreaks`; a mention never runs code or opens a URL.

## Tests

- `mentions.test.ts`: `mentionId` accepts only the exact form; `mentionsIn` skips code; `withoutMentionSyntax`; `atQuery` ignores emails and follows the caret; `insertMention` with an awkward title round-trips through `mentionsIn` and the escaping; `suggestions` order.
- A rendering test with the real `MARKDOWN` options: a list of mentions renders as task elements, the Markdown around them unchanged, a code span untouched, a web link still a link.
- `notes.test.ts`: `titleOf` of a note starting with a mention.
- MCP: a note's mentioned tasks are listed with their state.

## Verification

Checks in AGENTS.md; browser preview on a copy of the owner's tasks: write a goals note with headings and @ mentions, read it, tick one, open one.
Not verified here: the iPhone (needs a device build) — the picker under the caret with the phone keyboard in particular.

## Out of scope

Creating a task from the picker, mentioning notes or projects, a rich editor, backlinks from a task to the notes that mention it.
- Found while building the interactive card: the rendering test file had stopped loading (the expand hook had no server snapshot) while the summary line still read "passed". The hook now gives one (the same reading), and the checks read the "Test Files" line as well as the test count.
- Phone pass (owner: "just make it mobile friendly"), checked in a 393×852 frame on the preview: the note's top bar (back, folder, project, Read, Delete) was wider than the screen and pushed the page sideways (492 of 393 points); it now wraps. Mention titles wrap instead of being cut. The @ list's rows are taller on a phone, and the subtask count takes a larger tap area. The @ list was checked to sit inside the screen under the line being written.
- Not verified: the picker with the iPhone's own keyboard on a device (focus staying in the note when a row is tapped).
- Review round (one reviewer, read-only): no security finding, notes without mentions render as before. Seven findings, all fixed: (1) the check and title did nothing for a task finished before today — reopening now brings it back as the Completed page does, the title opens the Completed page; (2) picking at the end of a line moved the caret to the next line — fixed, and the test that encoded the bug corrected; (3) inserting a mention wiped the field's own undo — now inserted with insertText, checked in the browser (Cmd+Z takes the mention back to "@pass"); (4) a task finished long ago was called deleted (in the card and over MCP) — now "finished a while ago, or deleted", `found: false`; (5) code detection for chips and MCP missed indented fences and double-backtick spans — matched; (6) Enter in an input method, with modifiers, and the list staying after the note loses focus — respected and closed; (7) Esc stuck to a position — reset once that @ is gone.
