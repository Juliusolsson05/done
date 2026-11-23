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
2. **How a mention reads** — *Default: inline, as a small task: round check, live title, due date, project dot.* In a list it reads like a checklist of real tasks. The title is the task's current one; the link text is only the fallback.
3. **Ticking in a note** — *Default: finishes (or reopens) the task*, the same as ticking it in a list.
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
