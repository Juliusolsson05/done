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
3. **Wide screen** — *Default: a folder column left of the notes list*; on a phone, folders first, then a folder's notes, then the note.
4. **New folder** — *Default: named in place in the folder column, then selected*; an empty folder is kept on this device until a note goes in (see ruling).
5. **Rename and delete** — *Default: buttons under the selected folder's name*. Delete moves its notes out of the folder, never deletes a note, and can be undone.
6. **MCP** — *Default: notes show their folder; add_note and update_note take one; list_notes can filter by one.*

Answered 2026-11-23: the owner asked for folders; 1–6 are defaults shown in chat and **UNCONFIRMED** until the preview.

Ruling: a folder exists because a note is in it; a folder made on this device and still empty is remembered in the browser's storage (`done-note-folders`) until a note goes in or it is deleted — because a folder table would have to sync — cost if wrong: an empty folder made on the Mac does not show on the phone until it has a note.

Ruling: renaming and deleting a folder re-save each note in it through the existing `save_note`, rather than a new call — the notes in one folder are few, and every write then syncs as an ordinary note edit — cost if wrong: renaming a folder of hundreds of notes is hundreds of writes.

Ruling: `{table}_edited` triggers are dropped and made again each time a file is opened, so their column list always matches `TABLES` — a file from before folders would otherwise not count a folder-only change as a change to sync — cost if wrong: none found; the triggers hold no state.

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
