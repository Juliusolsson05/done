// Links from one note to another (see noteLink in lib/mentions): drawn as a
// small chip with the linked note's title as it is now, in the editor (as an
// atom, components/mention-atoms) and when the note is read (here).
//
// The Notes page holds the notes, so it hands them down with a way to open
// one: the read view and the editor are deep inside it, and the editor's
// chips are plain DOM that cannot take props.
import { createContext, useContext, type ReactNode } from 'react'
import { FileTextIcon } from 'lucide-react'
import { titleOf, type Note } from '@/lib/notes'
import { cn } from '@/lib/utils'

export interface NoteLinks {
  // Every note stored, whatever space is chosen: a chip looks its note up
  // here, so a link to a note in another space still shows its title.
  notes: Note[]
  // The notes of the space chosen, the only ones the @ list offers: a
  // workspace note must not take a personal note's title into its text,
  // where the others in it would read it.
  offered: Note[]
  open(id: number): void
  // The notes of the space chosen that link to this one, newest first.
  linkedFrom(id: number): Note[]
}

export const NoteLinksContext = createContext<NoteLinks>({ notes: [], offered: [], open: () => {}, linkedFrom: () => [] })
export const useNoteLinks = (): NoteLinks => useContext(NoteLinksContext)

// The linked note's title now, or null only when there is no such note (it
// was deleted). A note emptied of its words still exists and still opens: it
// is called what the list calls it, New note.
export function linkedTitle(notes: Note[], id: number): string | null {
  const note = notes.find((n) => n.id === id)
  return note ? titleOf(note.text) : null
}

export const MISSING_HINT = 'This note is missing: it was deleted'

// A link to a note in a note being read: tapped, that note opens. One that
// is missing shows the words it was written with, greyed, and does nothing.
export function NoteLinkChip({ id, fallback }: { id: number; fallback: ReactNode }) {
  const { notes, open } = useNoteLinks()
  const title = linkedTitle(notes, id)
  const missing = title === null
  return (
    <button
      type="button"
      data-note-link={id}
      disabled={missing}
      title={missing ? MISSING_HINT : undefined}
      onClick={() => open(id)}
      className={cn(
        'inline-flex max-w-full items-baseline gap-1 rounded-md bg-primary/6 px-1 py-px align-baseline font-medium text-primary [box-decoration-break:clone]',
        'hover:bg-primary/12 active:bg-primary/12',
        missing && 'bg-muted text-muted-foreground line-through hover:bg-muted',
      )}
    >
      <FileTextIcon className="size-[0.95em] shrink-0 self-center" aria-hidden />
      <span className="truncate">{title ?? fallback}</span>
    </button>
  )
}

// Above a note while it is written: the notes that link to it, to go to.
export function LinkedFrom({ note }: { note: number }) {
  const { linkedFrom, open } = useNoteLinks()
  const from = linkedFrom(note)
  if (from.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label="Linked from">
      <span>Linked from</span>
      {from.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => open(n.id)}
          className="inline-flex max-w-64 items-center gap-1 rounded-md border px-1.5 py-0.5 hover:bg-accent"
        >
          <FileTextIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{titleOf(n.text)}</span>
        </button>
      ))}
    </div>
  )
}
