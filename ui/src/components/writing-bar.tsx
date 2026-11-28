// The bar above an iPhone or iPad keyboard while a note is written, as Apple
// Notes has: checklist, bullet, heading, bold, a task, and Done to put the
// keyboard away. It sits just above the keyboard, wherever the keyboard is,
// by following the visual viewport (the part of the page that can be seen).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AtSignIcon, BoldIcon, HeadingIcon, IndentDecreaseIcon, IndentIncreaseIcon, ListChecksIcon, ListIcon, ListOrderedIcon } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { cycleHeading, keyboardInset, minimalChange, toggleBold } from '@/lib/live-preview'

import { bulletedList, checklist, indentList, listMoveAt, numberedList, outdentList, selectedLines } from '@/lib/note-list'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export const BAR_HEIGHT = 44

// Whether this is a touch screen: the bar is only for an on-screen keyboard.
export function useCoarsePointer(): boolean {
  const query = '(pointer: coarse)'
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const changed = () => setCoarse(list.matches)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [])
  return coarse
}

export interface Viewport {
  top: number
  left: number
  width: number
  height: number
  // How much of the window's bottom the keyboard covers.
  inset: number
}

// The visual viewport, followed while `on`: it shrinks when the keyboard
// comes up and moves when the page scrolls under it. `onResize` is told when
// its size changes (the keyboard came, went or changed height), not when it
// is only scrolled: scrolling is the reader's own.
export function useVisualViewport(on: boolean, onResize?: (viewport: Viewport) => void): Viewport | null {
  const [viewport, setViewport] = useState<Viewport | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!on || !vv) {
      setViewport(null)
      return
    }
    const read = () => {
      const next = { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height, inset: keyboardInset(window.innerHeight, vv) }
      setViewport(next)
      return next
    }
    const resized = () => onResize?.(read())
    resized()
    vv.addEventListener('resize', resized)
    vv.addEventListener('scroll', read)
    return () => {
      vv.removeEventListener('resize', resized)
      vv.removeEventListener('scroll', read)
    }
    // onResize is read when the viewport changes, not a reason to listen again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on])
  return viewport
}

// The lines under the selection, each changed by `edit`, sent as the least
// change each needs. A single caret keeps its distance from the line's end,
// so on an empty line it lands after the new marker.
function editLines(view: EditorView, edit: (line: string) => string) {
  const { state } = view
  const sel = state.selection.main
  const first = state.doc.lineAt(sel.from)
  const last = selectedLines(state).last
  const changes = []
  for (let n = first.number; n <= last; n++) {
    const line = state.doc.line(n)
    const change = minimalChange(line.text, edit(line.text))
    if (change) changes.push({ from: line.from + change.from, to: line.from + change.to, insert: change.insert })
  }
  if (!changes.length) return
  if (sel.empty) {
    const fromEnd = first.to - sel.head
    const after = edit(first.text)
    const head = Math.max(first.from, first.from + after.length - fromEnd)
    view.dispatch({ changes, selection: { anchor: head }, userEvent: 'input.format', scrollIntoView: true })
  } else {
    view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true })
  }
}

function bold(view: EditorView) {
  const sel = view.state.selection.main
  const next = toggleBold(view.state.doc.toString(), sel.from, sel.to)
  view.dispatch({ changes: next.changes, selection: { anchor: next.anchor, head: next.head }, userEvent: 'input.format', scrollIntoView: true })
}

// An @ at the caret, with a space before it when it would join a word: the
// editor then opens the task picker as if it were typed.
function mention(view: EditorView) {
  const sel = view.state.selection.main
  const before = sel.from > 0 ? view.state.sliceDoc(sel.from - 1, sel.from) : '\n'
  const insert = /[\s([]/.test(before) ? '@' : ' @'
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.type', scrollIntoView: true })
}

// The desktop and touch tools use the same commands and the selection that
// was in the note before opening the menu. On a phone the keyboard stays up.
export function NoteListMenu({ view, touch = false }: { view: EditorView | null; touch?: boolean }) {
  const [open, setOpen] = useState(false)
  const chosen = useRef(false)
  const action = (label: string, icon: ReactNode, shortcut: string, run: (v: EditorView) => void, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:opacity-40 pointer-coarse:min-h-11 [&_svg]:size-4"
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => { if (touch) e.preventDefault() }}
      onClick={() => {
        if (!view || view.state.readOnly) return
        chosen.current = true
        run(view)
        setOpen(false)
      }}
    >
      {icon}{label}<kbd className="ml-auto text-xs text-muted-foreground">{shortcut}</kbd>
    </button>
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Lists"
          aria-label="Lists"
          disabled={!view || view.state.readOnly}
          tabIndex={touch ? -1 : 0}
          className={touch
            ? 'flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-accent [&_svg]:size-5.5'
            : 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:bg-accent pointer-coarse:hidden'}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => { if (touch) e.preventDefault() }}
        >
          <ListIcon className="size-4" />{!touch && 'Lists'}
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="List formatting"
        side={touch ? 'top' : 'bottom'}
        align="start"
        className="w-48 p-1"
        onOpenAutoFocus={(e) => { if (touch) e.preventDefault() }}
        onCloseAutoFocus={(e) => {
          if (chosen.current) {
            e.preventDefault()
            view?.focus()
          }
          chosen.current = false
        }}
      >
        {open && view && (
          <>
            {action('Numbered list', <ListOrderedIcon />, '1.', numberedList)}
            {action('Bulleted list', <ListIcon />, '-', bulletedList)}
            {action('Indent', <IndentIncreaseIcon />, 'Tab', indentList, !listMoveAt(view.state, 'in'))}
            {action('Outdent', <IndentDecreaseIcon />, '⇧ Tab', outdentList, !listMoveAt(view.state, 'out'))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function WritingBar({ view, viewport }: { view: EditorView; viewport: Viewport | null }) {
  // Above the keyboard; with no keyboard on screen (a hardware one on an
  // iPad), at the bottom, clear of the home indicator.
  const style = viewport
    ? viewport.inset > 0
      ? { top: viewport.top + viewport.height - BAR_HEIGHT, left: viewport.left, width: viewport.width }
      : { bottom: 'var(--safe-bottom)', left: viewport.left, width: viewport.width }
    : { bottom: 'var(--safe-bottom)', left: 0, right: 0 }
  const button = (label: string, icon: ReactNode, act: () => void) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      // The note keeps its focus, so the keyboard stays up.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        act()
        view.focus()
      }}
      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground active:bg-accent [&_svg]:size-5.5"
    >
      {icon}
    </button>
  )
  return createPortal(
    <div
      role="toolbar"
      aria-label="Formatting"
      style={{ ...style, height: BAR_HEIGHT }}
      className="fixed z-50 flex items-center gap-1 border-t border-border bg-background/90 px-2 backdrop-blur-xl backdrop-saturate-150"
    >
      {button('Checklist', <ListChecksIcon />, () => checklist(view))}
      <NoteListMenu view={view} touch />
      {button('Heading', <HeadingIcon />, () => editLines(view, cycleHeading))}
      {button('Bold', <BoldIcon />, () => bold(view))}
      {button('Mention a task or link a note', <AtSignIcon />, () => mention(view))}
      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        // Done puts the keyboard away.
        onClick={() => view.contentDOM.blur()}
        className="ml-auto flex h-11 shrink-0 items-center px-3 text-body font-semibold text-primary active:opacity-40"
      >
        Done
      </button>
    </div>,
    document.body,
  )
}
