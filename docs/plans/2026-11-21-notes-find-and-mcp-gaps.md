# Find notes by word or date, and fill the gaps in the MCP tools

Fixes #29.
Branch `feat/notes-find` · Worktree `../done-wt/notes-find` · Base `origin/main` @ c7946b9 (2026-11-21)
Status: built; waiting for the owner to look at the local preview before merging.

## Outcome

**Notes.** A note can be found again without the page growing controls. Two things, both as in Apple Notes:
- a search field above the list, which narrows the list as you type, over all of a note's text;
- the list grouped under quiet date headings: Today, Yesterday, Previous 7 Days, Previous 30 Days, then each month ("October"), then each older year.

Nothing else: no filter menu, no sort options, no tags.

**Markdown** (asked for during the build): a note reads as formatted Markdown and a click edits its plain text. A `# Title` first line is listed as "Title".

**MCP.** Close the gaps an agent hits in daily use, while staying a small set of task-shaped tools (11 → 13).

## Evidence (verified, do not re-derive)

- Guidance read on 2026-11-21: Anthropic's "Writing effective tools for agents" (design tools around what an agent is trying to do, not one per endpoint; return what the agent needs; clear names), Block's MCP playbook (top-down from workflows), Workato and Phil Schmid (roughly 5–15 tools per server; overlapping tools confuse a model; keep responses small).
- Done's MCP server (`crates/mcp/src/lib.rs`) after #28 has 11 tools: list_tasks, add_task, update_task, complete_task, delete_task, list_projects, add_project, list_notes, add_note, update_note, delete_note.
- Gaps found against what the app can do:
  1. `list_notes` returns every note in full. That grows without bound, and an agent can't ask "the note about funds".
  2. A task an agent finished by mistake can't be reopened (`open_task` only finds open tasks), and an agent can't see what was finished today, though `Store::state` already returns today's finished tasks.
  3. The time sheet can't be read ("how long did I focus today"), though `Store::entries(day)` exists.
- Gaps left on purpose: renaming or deleting a project (rare; one click in the app); starting a focus session (the window owns the timer and the menu bar); MCP against a hosted account (the MCP server reads the Mac's own tasks file; when the app is signed in to a hosted account the agent still sees the local file; this needs the hosted API and a token, and is its own piece of work).
- The app reopens a task with `markOpen` (`ui/src/lib/tasks.ts`): the task, and its subtasks that were finished the same day.

## Design

### Notes interface

- `ui/src/lib/notes.ts`
  - `matches(note, query): boolean`: every word of the query appears somewhere in the text, case and accents ignored; an empty query matches all.
  - `groupByDate(notes, now): { label: string; notes: Note[] }[]`: newest first, using the headings above, with only non-empty groups.
- `ui/src/components/notes.tsx`: a search field at the top of the list column ("Search", a magnifier icon, Esc clears it), and the list shows `groupByDate(sorted.filter(matches))` with a small muted heading per group. With a query and no matches: "No notes match". Opening a note keeps the search. On a phone the field sits above the list the same way.

### Markdown

- Package: `markdown-to-jsx` 9.10.6, exact. It has no dependencies, is maintained (published 2026-11-06), builds React elements (no HTML strings), and adds about 32 KB gzipped. `react-markdown` was not picked because it brings 11 unified/remark packages; `marked` because it outputs an HTML string and would need a sanitizer; `snarkdown` because it has not been updated since 2022.
- Options: `disableParsingRawHTML` (raw HTML stays text), `forceBlock`, links overridden to open in the browser through `openLink` (http and https only).
- `NoteText`: rendered when the note has text; a click (not on a link or checkbox) or Enter edits; blur or Escape shows it rendered again; a new or empty note opens for typing. The editor uses the mono face so the Markdown reads as source.
- `titleOf` (interface) and `title_of` (MCP) drop a leading `#`–`######` and a closing `#` run, so `# Funds` is "Funds" and `#hashtag` stays as it is.
- Styles: `.note-md` in `ui/src/index.css`, only what a jotted note uses (headings, lists, task lists, links, code, quote, rule, table).

Ruling: checkboxes in a task list show but do not toggle from the rendered note. Ticking one rewrites the text and would need its own small parser step. Cost if wrong: you tick it by editing `[ ]` to `[x]`.

### MCP (`crates/mcp/src/lib.rs`)

- `list_notes { search? }`: the 20 most recently changed notes that match (all words, case ignored), with the number left out when there are more. Still the full text: notes are short and the agent usually wants the content.
- `list_tasks { filter }` gains `finished_today`: today's finished tasks (not subtasks), with their subtasks.
- `reopen_task { id }`, new: reopens a task finished today, with the subtasks finished the same day, as the app does. A task finished on an earlier day is refused with a message saying so.
- `time_sheet { day? }`, new: one day's focus blocks (title, start and end as local clock times, planned minutes, focused minutes) and the totals; the day defaults to today.

Ruling: `reopen_task` reaches only tasks finished today, because `state` only carries those; that covers the "finished the wrong one" case. Cost if wrong: an older one is reopened in the app.

Ruling: no new search tool for tasks. Agents filter the list they get, and a second search tool would overlap with `list_tasks`. Cost if wrong: longer `list_tasks` replies for someone with hundreds of open tasks.

## Tests

- Interface: `matches` finds a word anywhere, needs every word, ignores case and accents ("Fjord" finds "fjörd"), and an empty query matches everything. `groupByDate` puts notes from today, yesterday, 3 days, 20 days, last month and two years ago under the right headings in that order, with no empty groups.
- MCP: `list_notes` with a search returns only matching notes and caps at 20 with the count left out; `finished_today` lists a task completed through `complete_task`; `reopen_task` puts it and its same-day subtasks back and refuses an open task; `time_sheet` returns a block recorded through `Store::record`, with totals.

## Verification

- `npm run typecheck && npm test && npm run build`; `cargo test -p done-core -p done-mcp -p done-server`.
- Local web app on a copy of the owner's tasks file, with notes of different ages: search narrows and clears, the headings read right. Then show the owner.
- **Verification boundary:** the phone layout is checked in a narrow browser window only; the packaged apps come from the release.

## Out of scope

Tags, pinning, sorting options, folders; project rename or delete over MCP; starting focus over MCP; MCP against a hosted account (noted above as the next real gap).

## Execution notes

- Plan vs built: Notes interface, Markdown, MCP MATCH. One DRIFT, found in the preview and fixed: a search that hid the open note left it showing on the right; the first match now opens instead (wide screens; on a phone the list shows alone anyway).
- Verified: typecheck, 416 interface tests, build; `cargo test -p done-core -p done-mcp -p done-server` (18 + 8 + 17). Local web app on a copy of the owner's tasks file with ten example notes from today to 2025: headings Today, Yesterday, Previous 7 Days, Previous 30 Days, October, September, 2025; "seed" narrows to two, "seed fjord" to one; a Markdown note renders headings, a numbered list, bold and italics, task-list checkboxes, a link and a quote, and a click shows its source with Escape returning to the rendered note.
- Not checked here: the phone layout; the packaged apps.
