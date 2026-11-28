# Fewer buttons over a note on iPad

Issue #108.

## Outcome

On an iPad the open note's header shows what is used all the time and one ⋯
that holds the rest, every control big enough for a finger. On an iPhone a
folder's Rename and Delete go behind a ⋯ too. The Mac and the web with a mouse
look exactly as they do today.

## Evidence

From the mobile audit (findings M08, M14, M15, M19), measured in Chromium with
touch emulation on a copy of seeded notes:

- iPad 820 and 1366: the note header shows Folder 122x28, Project 127x28,
  Read 71x28, Delete 28x28, New note 98x28. iPad 1024 upright (one note at a
  time) shows the same without New note. While writing, the six-button writing
  bar is also on screen: eleven note controls.
- iPhone note: back and a 44x44 ⋯ that opens an action sheet. Already right.
- iPhone folder list: back, Rename 71x28, Delete 62x28, compose.
- The writing bar's Lists menu shows "Tab" and "⇧ Tab" on touch screens.
- Opening Folder or Project in the iPhone note sheet logs React's "unique key"
  error: `row()` in `notes-phone.tsx` makes list rows without a key.

## Decisions

- **What stays visible on iPad**: Read (Edit while reading) and New note
  where the header has it (the list and note side by side), plus ⋯. Read is a
  mode switch used back and forth all the time, and on an iPad notes are read
  as much as written; New note is the page's main action and has no other
  button on iPad (the iPhone has its compose button). Folder, Project and
  Delete are set once per note, so they go in the menu. LiveFaces (who else is
  in a shared note) is not a control and stays where it is.
- **The menu**: a popover from ⋯ (the existing `ui/popover.tsx`), not the
  iPhone's action sheet: a sheet rising across a 1366-wide screen is a phone
  idiom. It lists the folders and the projects inline, each with a check on the
  current one, so moving a note is two taps (⋯, then the folder), as it is
  with the pickers today. Delete note is last, red, under a separator, and kept
  outside the scrolling part so a long list of projects never hides it.
- **Sizes**: on a tablet the header's controls are 44 px tall (`h-11`), the ⋯
  is 44x44 (the iPhone's `MoreButton`), and menu rows are 44 px.
- **Which layout**: `useLayout() === 'tablet'` (`hooks/use-mobile.ts`): a
  touch screen at least 768 wide whose short side is over 500. The Mac, Windows
  and a browser with a mouse are `desktop` and keep today's header.
- **Desktop**: not cramped at 1440 (five actions fit beside the title with
  room to spare). A desktop window narrowed towards 768 wraps them, as it did
  before; left alone, for the owner to decide.
- **iPhone folder list**: Rename and Delete move into a ⋯ in the bar (an action
  sheet with Rename folder and Delete folder, Delete red and last). The bar then
  has back and ⋯, the page the compose button: three controls, all 44 px or
  more. Rename still edits the name in place under the title.
- **Tab hints**: the Lists menu inside the writing bar (only there on touch
  screens) leaves out the Tab and ⇧ Tab hints; "1." and "-" stay, since they
  are typed and work on a touch keyboard too.
- **Keys**: `row()` takes a key.
- **Undo and moving**: the menu calls the same `remove` and `refileOpen` as
  the pickers and the trash button, so Delete is undone by the toast's Undo and
  Cmd+Z exactly as today, and moving saves the same way.

## Folding many refs behind a +

Already there (`note-refs.tsx`, `lib/note-refs.ts`, with tests): up to four
tasks and links show as chips; more fold into one line, "12 tasks and 3
links", opened with +, remembered per note for the session. Nothing to add.

## Checks

- `ui/checks/notes-header-menu.cjs`: Chromium with touch at 820x1180, on the
  built UI with the API faked. Counts at most three visible controls in the note
  header, each at least 44 px tall; opens ⋯ by tap; moves the note to a folder
  through it and sees the save; deletes it through the menu, then undoes, and
  sees it back. Fails on origin/main.
- typecheck, unit tests, build.
- Before and after screenshots at iPhone 390x844, iPad 820x1180, 1024x1366,
  1366x1024 and desktop 1440x900.

## Verified

(filled in as it is done)

## Not verified

- A real iPad and WebKit: checked in Chromium with touch emulation only.
