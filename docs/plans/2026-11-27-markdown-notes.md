# Write a note with nested lists and task cards

Branch `feat/markdown-notes` from `5b4662b`. Issue #84.

## Outcome

Open an existing note, read the formatted text, click into a sentence, and write there.
Starting with a numbered item, use Enter, Tab and Shift+Tab to create a nested outline.
See the real task beside the paragraph that refers to it.
Keep an explicit Read view for selecting text and reading tables.

## Evidence (verified, do not re-derive)

- Existing notes are Markdown strings. Personal saves, MCP and the collaborative Y.Text use that representation.
- CodeMirror already formats inactive lines and makes mentions atomic.
- The current Tab binding indents by an editor indent unit. A numbered item needs the parent's content column.
- The existing editor draws every task as a label. Only the reader distinguishes standalone cards from references inside sentences.
- The reader already shares a real task component with completion, reopening, subtasks and task navigation.
- A previous read-view change deliberately removed click-to-edit because selecting a passage triggered it.
- Of 27 notes in a private local snapshot, six contain a task reference and twenty contain a digit followed by a period and space. The latter measures candidate lists, not parsed lists.
- [Notion keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts) documents nesting under the preceding block with Tab and promoting with Shift+Tab.
- [Obsidian editing views](https://help.obsidian.md/edit-and-read) describes a formatted editing surface with syntax revealed at the cursor and an explicit reading view.
- [CommonMark list items](https://spec.commonmark.org/0.31.2/#list-items) defines the content indentation from both the marker width and the following space.

## Interaction decisions for the preview

- UNCONFIRMED product default: use the formatted editing surface for opening notes. No focus or keyboard until someone clicks in an existing note. A new note starts ready to type.
- Keep the explicit Read button. Selecting text there stays in Read. The Edit button returns to the writing surface.
- A standalone task reference gets a card while editing. A mention in the middle of prose stays compact.
- A card control performs its labelled action. Arrow navigation and deletion across a reference treat the Markdown link as one unit.
- List operations should preserve children and continuations. Fenced code and ordinary paragraphs keep their text.
- Keep the existing @ picker ahead of list key bindings. Choosing an offered task with Tab must still work.
- Use local note edits for list changes so editor undo and collaborative saves follow their existing path.

## Implementation and checks

1. Add Markdown-aware list commands and keyboard bindings, with tests for parsed levels, nested siblings, multi-digit parents and returning to the outer list.
2. Reuse the existing task card in the editor and pass updates through React context. Test standalone versus inline, existing Markdown and fenced examples.
3. Exercise a note in a real browser, including caret placement, task cards, text selection in Read, undo and persistence.
4. Run interface typecheck, tests and build. Serve the built web app locally on a private database copy. Review the diff before opening the PR.

## Out of scope

A replacement document format, hosted deployment, native installation, and a general-purpose Notion block system.

## Research and interaction choices

Notion treats nesting as a relationship between blocks. Its numbered-list block supports children, a starting number and a display format. We adopted the keyboard interaction and used the existing Markdown parser to determine parentage. [Notion block API](https://developers.notion.com/reference/block#numbered-list-item)
Obsidian's Live Preview preserves a continuous text selection across formatted content. Its separate Reading view fits the earlier request to copy without changing the note. [Obsidian editing views](https://help.obsidian.md/edit-and-read)
Typora describes rendering Markdown during writing, with raw Markdown available on copy. Obsidian embeds show a referenced object's contents inline. In done, a task reference already has a stable Markdown address, so its card can show current task data without rewriting the note. [Typora quick start](https://support.typora.io/Quick-Start/) · [Obsidian embeds](https://obsidian.md/help/embeds)

## Built and verified

- Lists exposes numbered and bulleted markers and indent/outdent on desktop and touch. In an outline, Enter continues the list and an empty item exits one level. The stored value stays Markdown.
- Moving a parent takes its continuation lines and nested children. Numbering is based on the list's starting value, including pasted lists with repeated markers.
- Standalone task references use the same live task card as Read. Within prose they use a compact task control. Both keep a single underlying Markdown link.
- Switching to Read keeps the editor and undo history mounted. Edit restores the caret. Remote refreshes in Read update the text without sending a save or creating a local undo step.
- Chrome verified the desktop menu, Tab, Shift+Tab, Enter, undo, exact saved Markdown, nested HTML, and list controls at a 390px touch viewport. A separate check verified card actions, wrapping, inline references, atomic deletion, and task-versus-text undo.
- Review reproduced child flattening on list-type conversion, formatting the line after a selection, indenting from a continuation, and a hidden editor echoing remote changes. These were fixed and retested. The remote-change browser check observed zero save requests and preserved the external change through undo.
- Verified in the web app. Physical iPhone keyboard and a two-person hosted editing session remain outside this preview.
