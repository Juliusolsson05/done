# Notes: write like Apple Notes on iPhone and iPad

Branch `fix/mobile-notes-apple` · Worktree `../done-wt/mobile-notes-apple` · Base `origin/main` @ 946002b (2026-11-23)
Status: building. Size: standard plan. Not pushed; the owner sees it before it merges.

## Outcome

Writing a note on an iPhone or iPad feels like Apple Notes: the first line is a large bold title with the
date under it, headings, bold, lists and checklists look formatted while you write, a checklist circle is
tapped to tick it, the keyboard has a small bar of writing tools above it, and the note has one way back
and its actions behind ⋯. On an iPad the note is never squeezed into a narrow column. The Mac keeps its
layout.

## Evidence (verified, do not re-derive)

- Owner, 23 Nov: "notes experience is not close to being as smooth as Apple Notes, the spacing is wrong,
  the writing experience is wrong because we are not using the proper writing elements."
- Mobile audit (`docs/mobile-audit` branch, Notes section): the editor shows raw Markdown (`#`, `**`, `-`);
  two stacked back links on All notes ("‹ Lists" from the shell's PhoneHeader, "‹ Folders" from notes.tsx);
  "+ New note" is a small text link; folder/project/Read/Delete are cramped in a wrapped row above the text;
  iPad portrait shows sidebar + list + note with the note ~110 pt wide; Read cards dump a task's whole notes.
- Stored format: Markdown. A workspace note's live document is a Yjs `Y.Text` named `text`
  (`lib/collab.ts` `TEXT`); the room (`crates/server/src/collab.rs`) saves `text_of(doc)`. So the editor
  stays CodeMirror 6 + y-codemirror.next; no ProseMirror/TipTap.
- `@codemirror/view` 6.43.15 sets `autocorrect: off`, `autocapitalize: off`, `writingsuggestions: false`
  on the content and lets `EditorView.contentAttributes` override them (dist `updateAttrs`).
- `@codemirror/lang-markdown` 6.5.2 adds `markdownKeymap` (Enter continues a list/checklist, Backspace
  removes markup) at `Prec.high`. `markdownLanguage` (GFM) parses `Task`/`TaskMarker` and `Strikethrough`.
- `index.css` disables `user-select` on `body` for coarse pointers and re-enables it for inputs, textareas
  and `article` only; a `[contenteditable]` is not in that list.
- The phone page (`App.tsx` SidebarInset) has 16 px side padding and room for a 44 pt bar under the safe area.

## Decisions

1. **Live preview in CodeMirror** — markers are hidden (replace decorations) on every line the selection
   does not touch, and only while the editor has focus does a line show its markers; unfocused, the whole
   note reads formatted. Decorations are view-only; the only document change they make is the checklist
   circle's tap (an ordinary transaction, so it syncs through Yjs and undoes with Cmd+Z).
2. **Title** — the first line is always the title (28 px bold), whether or not it starts with `#`, as in
   Apple Notes. The date line ("23 November 2026 at 22:44", from the note's `updatedAt`) is a block widget
   under it, so it moves with the text and is never part of it.
3. **Links** — a web link shows its text (brackets and address hidden off the cursor line); Cmd-click
   still opens it. Task mentions keep their existing atom widget (`mention-atoms.ts`) and are skipped by the
   preview so the two never overlap.
4. **Type** — 17 px / 1.45 on touch and phones, 16 px / 1.45 with the Mac; 6 px after each line
   (each line is a paragraph in a note). 20 px side margins on phones. Readable max width kept.
5. **Accessory bar** — touch devices only (`pointer: coarse`), only while writing: Checklist, Bullet,
   Heading (none → `#` → `##` → none), Bold, @ (opens the existing picker), Done (blur). 44 pt targets.
   Placed with `visualViewport` just above the keyboard; the caret is kept above the bar through
   CodeMirror's `scrollMargins`, re-scrolled when the keyboard resizes the visual viewport.
6. **Phone navigation** — Notes owns its bar on the list and note screens (fixed, under the safe area):
   folders screen keeps the shell header (‹ Lists); All notes / a folder has one back (‹ Folders); an open
   note has ‹ back to its list and ⋯ (an action sheet: Folder, Project, Read/Edit, Delete). New note is a
   compose button (square-pen) bottom right, above the tab bar.
7. **List rows** — title 17 px semibold, then date and the first line of the body in grey on one line,
   hairlines between rows. Folder/project are left off the phone row (the row says what Apple's says).
8. **Read view** — kept; a mention card's description is clamped to 3 lines.
9. **Wide screens** — the Notes page measures its own width: when list (256) + gap (24) + editor (420)
   do not fit, it shows the list or the note (with ‹ back), not both. Otherwise unchanged (Mac).

## Not in scope

App/phone shell layout and safe areas (another branch), the timeline, menus, the task sheet, a rich-text
editor, pinned notes, swipe to delete, share sheet.

## Steps

1. `lib/live-preview.ts` (pure: which ranges hide on which lines, checklist/bullet/heading/bold edits,
   date line, wide layout choice) with tests written first and seen failing.
2. `components/live-preview.ts`: the CodeMirror ViewPlugin, widgets (bullet, checkbox, date) and theme;
   wired into `note-editor.tsx` with the iOS writing attributes; `[contenteditable]` selectable in CSS.
3. Accessory bar + keyboard avoidance in `note-editor.tsx`.
4. `notes.tsx`: phone nav bar, ⋯ sheet, compose button, Apple list rows, narrow wide-screen mode.
5. Read view clamp in `task-mention.tsx`.

## Verification

`npx tsc -b` clean and `npx vitest run` green in `ui/`. No browser in this lane: the look on a device is
unverified until the owner opens it.
