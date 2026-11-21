# Notes that are easy to read

Branch `fix/note-reading` · Base `origin/main` (Done 0.1.87)
Status: built and checked in a local preview on a copy of the owner's notes; the owner asked for it to be shipped now.

## Outcome

Reading a note is comfortable: a generous line height, room between paragraphs and list items, clear space above each heading, a readable line length. A new line in a note stays a new line. Selecting text in Read mode never switches to writing.

## Evidence (verified, do not re-derive)

- The owner's screenshots of 0.1.87 (two real notes: a numbered list of funds, and a strategy note with headings, bullets, a table and a numbered plan): text at 15px with `leading-relaxed`, list items packed together, headings with no space above them.
- markdown-to-jsx wraps its output in a `<div>` when `forceBlock` is set, so the `[&>*+*]` spacing rule on the article never reached the blocks.
- Markdown joins two lines into one paragraph; in a note, Enter means a new line.
- Read mode switched to writing on any click on the text, including the click that ends a selection.

## Change

- `DOCUMENT` (`ui/src/components/notes.tsx`): 16px text, `leading-7`, `max-w-[68ch]`; `mt-4` between blocks; `mt-9` above an h2 and `mt-7` above an h3, little below; `mt-2` between list items, quiet markers; a table with light rules and padded cells. The editor uses the same size, line height and width.
- `wrapper: Fragment` in the Markdown options, so the blocks are the article's own children.
- `keepLineBreaks(text)` (`ui/src/lib/notes.ts`): a line followed by another plain line ends with a hard break; lists, headings, quotes, tables and code blocks are left as written. Tested.
- `NoteDocument` no longer has a click handler. Edit or Esc goes back to writing.

## Verification

- typecheck, interface tests, build.
- Local web app on a copy of the owner's tasks file, with both of the owner's notes: headings set apart, lists spaced, the table readable, a passage selected without leaving Read mode.
- **Boundary:** the packaged app is not opened before release; the same interface ships in it.
