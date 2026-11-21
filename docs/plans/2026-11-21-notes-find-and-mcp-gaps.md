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
- Scope added during the preview (owner): a note is no longer a box with its own scroll. The field grows with the text and the page scrolls; the note list stays beside it (sticky); the text is held to a readable width; Delete moved to the header as an icon. The sidebar can be put away in a window as well as on a phone: `collapsible="offcanvas"` everywhere, a button pinned to the page's top left, and Cmd+B (the sidebar component's own shortcut). Whether it was put away is remembered through the sidebar's own `sidebar_state` cookie. Checked in the preview: a 25-section note scrolls with the page with the list in place; Cmd+B and the button both work; collapsed stays collapsed after a reload.
- Ruling: the textarea grows by measuring `scrollHeight`, not CSS `field-sizing`, which the macOS web view may not have — cost if wrong: none.
- Scope changed during the preview (owner):
  - Markdown is no longer how a note is edited. Writing is always plain text; a **Read** button in the header shows the note formatted as a document with the list hidden, and **Edit**, Esc, or a click on the text goes back. The rendered view's checkboxes do not toggle.
  - **⌘K** (and Search in the sidebar, for the phone) opens search over the whole app: projects, tasks by title, notes and subtasks (open before finished), and notes, with the matching line shown; Enter opens a project's list, a task in its list with the editor open (a subtask through its task), or a note (`View` gained `{ kind: 'notes'; id?: number }`). Logic in `ui/src/lib/search.ts`, tested.
  - **⌘F** finds text on the current page: a bar at the top right, every match marked and the current one stronger, Enter and Shift+Enter move, Esc closes. It uses the CSS Custom Highlight API, so the page's DOM is never changed; it follows the page as it changes (MutationObserver). Text inside a text field (a note being written) is not marked; the notes search covers that. Logic in `ui/src/lib/find.ts`, tested.
  - Fixed in the preview: a note opened from ⌘K lost to the "always open the newest" rule; an empty note left behind by a reload is now cleared when Notes loads.
- Verified for these: 425 interface tests, typecheck, build; in the preview ⌘F on the Inbox ("the": 6 matches, Enter to the 2nd), ⌘K "alpha" opening the Seed round funds note, Read and back via Edit and via a click.
- More scope added by the owner during the preview, each checked in the preview:
  - ⌘Z undoes anywhere (`ui/src/lib/undo.ts`): every `change()` records what it altered, and undo puts back only that, so an agent's or another window's edit to other tasks stays. Changes within a second are one step (a drag). Note deletes add their own step. In a text field ⌘Z stays the field's. Cmd keys are now taken in the capture phase: in done next, ⌘K did nothing until then.
  - ⌘F marks only task and note text (`data-findable`), not headings or dates. ⌘K shows a task in its list (or the page you are on) and flashes it, instead of opening the editor, so it can be ticked off.
  - Sounds: focus start, a block run to its end (the biggest reward), a faint tick when search or find opens, and the fuller chord for the last subtask, an emptied list and every 5th task finished in a day (`finishesBig`, tested).
  - Quick add: `@project` works like `#project`, is marked in the field like a date, and while it is typed the matching projects are offered; Tab takes the first (`suggestProjects`, `takeSuggestion`, tested).
  - A note can belong to a project: a picker in the note's header, the project shown in the list, a project's notes listed on its page with New note there. Over MCP, `add_note` and `update_note` take `project`. Deleting a project keeps its notes (`ON DELETE SET NULL`).
  - Extras in the sidebar, below Projects: Focus, Time sheet and a new Completed page (key 9). Completed lists finished tasks by day (`Store::finished`, at most 300); ticking one puts it back. Ruling: putting back a task finished before today is undone by finishing it again on its old day, not by the generic undo, which would take it out of the window and so delete it — cost if wrong: none found; checked in the preview database.
  - The owner's design rules: shadcn components wherever one fits, and styles only through Tailwind and the theme's tokens. The Markdown document styles moved from the stylesheet to Tailwind classes; the two ⌘F highlight colours stay in CSS because Tailwind cannot address `::highlight`, and now use the theme's primary colour. The sidebar button lives in the sidebar's header, or inside the page when the sidebar is hidden, not on the page's edge.
  - `AGENTS.md` (with `CLAUDE.md` pointing to it): how done is developed, previewed as "done next", released, and the traps already hit.
