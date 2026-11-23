# Notes: folders

Fixes #39.
Branch `feat/note-folders` · Worktree `../done-wt/note-folders` · Base `origin/main` @ 56eacdb (2026-11-23)
Status: building with the defaults below; the owner sees it as "done next" before merging. Size: standard plan.

## Outcome

Notes can be put in folders, as in Apple Notes. On a wide screen a folder column sits left of the notes list (All notes, each folder, New folder); on a phone the folders come first and a tap shows a folder's notes. A note is moved with a folder picker beside its project picker. A folder can be renamed or deleted; deleting one keeps every note in it.

## Evidence (verified, do not re-derive)

- A note is one row in `note` (`crates/core/src/lib.rs`: `Note`, `SaveNote`, `notes()`, `save_note()`), with an optional `project_id` added by `ALTER TABLE` for older files.
- Sync (`crates/core/src/replica.rs`): `TABLES` lists each table's content columns. `prepare()` makes `{table}_edited` triggers `AFTER UPDATE OF <those columns>` with `CREATE TRIGGER IF NOT EXISTS`, so a file that already has the trigger keeps the old column list. `rows_since` and `merge` name the note's columns one by one.
- The hosted server (thedone.app) runs the same core; it is deployed from a separate private repository, not by this repo's release.
- `ui/src/components/notes.tsx`: `type()` rebuilds the open note as `{ id, text, updatedAt, projectId }`, so any new field is lost on the next keystroke unless it is carried. Empty notes are deleted when left and when the list is read again.
- MCP (`crates/mcp/src/lib.rs`): `list_notes`, `add_note`, `update_note`, `delete_note`; `describe_note` shapes what an agent sees.

## Decisions

1. **Storage** — *Default: a `folder` text column on the note* (none = not in a folder). It travels with the note through sync with no new table, tombstones or re-keying. Alternative: a folder table, which sync would have to learn.
2. **Folders = their own thing, not projects** — *Default*. A note keeps its project as well.
3. **Wide screen** — first built as a folder column left of the notes list; **changed 2026-11-23 at the owner's request** (four columns with the app's sidebar was too much) to folders listed under Notes in the app's sidebar while Notes is open. On a phone, folders first, then a folder's notes, then the note.
4. **New folder** — *Default: named in place in the folder column, then selected*; an empty folder is kept on this device until a note goes in (see ruling).
5. **Rename and delete** — right-click a folder in the sidebar (Open, New note here, Rename, Delete folder); on a phone, buttons in the folder's list. Delete moves its notes out of the folder, never deletes a note, and can be undone.
6. **MCP** — *Default: notes show their folder; add_note and update_note take one; list_notes can filter by one.*

Answered 2026-11-23: the owner asked for folders; 1–6 are defaults shown in chat and **UNCONFIRMED** until the preview.

Ruling: a folder exists because a note is in it; a folder made on this device and still empty is remembered in the browser's storage (`done-note-folders`) until a note goes in or it is deleted — because a folder table would have to sync — cost if wrong: an empty folder made on the Mac does not show on the phone until it has a note.

Ruling: renaming and deleting a folder re-save each note in it through the existing `save_note`, rather than a new call — the notes in one folder are few, and every write then syncs as an ordinary note edit — cost if wrong: renaming a folder of hundreds of notes is hundreds of writes.

Ruling: a `{table}_edited` trigger whose column list is not the current one is made again when a file is opened, in one `BEGIN IMMEDIATE` transaction — a file from before folders would otherwise not count a folder-only change as a change to sync, and a drop and create outside a transaction left a moment with no trigger at all for another process to write in (review) — cost if wrong: none found; the triggers hold no state.

Ruling: a note that does not mention its folder keeps the one it has (`Option<Option<String>>`: left out is "not said", null is "no folder") — an app or hosted server from before folders sends notes without the field, and reading that as "no folder" would take a note out of its folder on every device the next time an old device edited it (review) — cost if wrong: a client that means "no folder" has to say null, which the interface and MCP always do.

## Design

- Core: `Note.folder: Option<String>`, `SaveNote.folder: Option<String>` (`#[serde(default)]`). `clean_folder`: trimmed, inner whitespace collapsed, blank becomes none, at most 60 characters. Column added before `replica::prepare` for older files.
- Replica: `"note"` columns gain `folder`; `rows_since` and `merge` carry it; triggers rebuilt.
- UI `ui/src/lib/notes.ts` (pure, tested): `cleanFolder`, `folderList(notes, kept)` (name and count, sorted ignoring case, one entry per name ignoring case), `inFolder(note, selected)`, `withFolder(notes, from, to)` (the notes whose folder changes, for rename and delete).
- UI `notes.tsx`: every rebuilt note spreads the note it replaces, so no field is dropped; the folder column / phone folder screen; the folder picker; a new note goes in the selected folder.
- MCP: `folder` in `describe_note`, `add_note`, `update_note` (null takes it out), and `list_notes` (`folder` filter).

## Tests

- Core: a note's folder is kept and cleaned (blank is none); a folder-only change is sent by sync even on a file whose trigger predates folders; a folder arrives on the other device through `exchange`.
- MCP: an agent puts a note in a folder, lists by folder, and takes it out.
- UI: `folderList` merges names ignoring case and counts; `withFolder` renames and clears only that folder's notes; `cleanFolder`.

## Verification

Checks in AGENTS.md; "done next" on the owner's Mac (real tasks file, as AGENTS.md says).
Not verified here: folders arriving on another device through thedone.app — that needs the hosted server redeployed from this commit, which happens outside this repository.

## Out of scope

Nested folders, dragging notes onto folders, folder icons or colours, sharing a folder.

## Execution notes

- Scope correction (owner, 2026-11-23): "it does not work that well when we have the 4 sidebars". Of three layouts offered (folders in the app sidebar, a switcher above the list, drill-down in the list), the owner chose the sidebar. The Notes page publishes its folders and their actions through `ui/src/lib/note-folder-panel.ts`; `AppSidebar` lists them under Notes and the right-click menu gains a `folder` target. The page owns the notes, so the sidebar never holds a copy.
- Checked in the web preview on a copy of the owner's tasks: make a folder from the sidebar, file a note with the picker, type in it (folder kept), rename by right-click, delete (notes kept) and Undo.
- Review round (one reviewer, read-only): six findings, all fixed. (1) An older device or server wiped folders — fixed by the ruling above, with a test that fails without it. (2) Undoing Delete folder re-saved old text — Undo now puts back only the folder, on each note as it is now. (3) The trigger rebuild was not atomic — fixed by the ruling above. (4) Empty folders kept on a device were never forgotten — forgotten once a note with text is filed there. (5) On a phone, New note on the folders screen filed into the folder just left — leaving a folder now clears it. (6) MCP's folder filter did not collapse spaces — it now cleans the name as stored names are. The Timeline branch had no findings.
