// Notes: press New note, type, and it is kept. For the list written down in
// the middle of a conversation that is not a task. The list on the left, the
// open note on the right; on a phone one at a time.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Markdown from 'markdown-to-jsx/react'
import { ChevronLeftIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { useIsMobile } from '@/hooks/use-mobile'
import { deleteNote, loadNotes, openLink, saveNote } from '@/lib/backend'
import { byNewest, groupByDate, isBlank, matches, titleOf, whenText, type Note } from '@/lib/notes'
import { play } from '@/lib/sounds'
import { cn } from '@/lib/utils'

// How long typing has to pause before the note is written.
const QUIET_MS = 500

export function Notes() {
  const isMobile = useIsMobile()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  // What is typed in the search field. Kept while notes are opened, so going
  // through the matches one by one does not lose it.
  const [query, setQuery] = useState('')
  // The note just made: its field opens with the cursor in it.
  const [fresh, setFresh] = useState<number | null>(null)
  // The note waiting to be written, and its timer. One at a time: switching
  // notes or leaving the page writes it at once.
  const pending = useRef<{ note: Note; timer: ReturnType<typeof setTimeout> } | null>(null)
  // Writes go one after another, so an older text can never land after a newer one.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef<Note[] | null>(null)
  latest.current = notes
  const openRef = useRef<number | null>(null)
  openRef.current = openId

  const write = (note: Note) => {
    queue.current = queue.current.then(() =>
      saveNote(note).catch(() => toast('That note could not be saved. Keep this page open and try again.', { id: 'said' })),
    )
  }

  const flush = () => {
    const waiting = pending.current
    if (!waiting) return
    clearTimeout(waiting.timer)
    pending.current = null
    write(waiting.note)
  }

  // Leaving a note: what was typed is written, and a note left empty is
  // removed, so a New note pressed by mistake leaves nothing behind.
  const leave = (id: number | null) => {
    flush()
    const note = latest.current?.find((n) => n.id === id)
    if (note && isBlank(note.text)) {
      setNotes((all) => all && all.filter((n) => n.id !== note.id))
      queue.current = queue.current.then(() => deleteNote(note.id).catch(() => undefined))
    }
  }

  const reread = () => {
    // Never under your hands: a note being typed is not replaced.
    if (pending.current) return
    loadNotes().then(setNotes, () => setNotes((all) => all ?? []))
  }

  useEffect(() => {
    reread()
    window.addEventListener('focus', reread)
    return () => {
      window.removeEventListener('focus', reread)
      leave(openRef.current)
    }
    // Set up once; reread and leave read only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A search that leaves out the open note opens its first match instead,
  // so the note on the right is always one of those listed.
  useEffect(() => {
    if (isMobile || !notes || !query.trim()) return
    const found = [...notes].sort(byNewest).filter((n) => matches(n, query))
    if (found.length > 0 && !found.some((n) => n.id === openId)) open(found[0].id)
    // Only when the search or the notes change; open reads the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, notes, isMobile])

  // On a wide screen a note is always open when there is one.
  useEffect(() => {
    if (!isMobile && openId === null && notes && notes.length > 0) setOpenId(notes[0].id)
  }, [isMobile, openId, notes])

  const open = (id: number | null) => {
    if (id === openId) return
    leave(openId)
    setOpenId(id)
  }

  const create = async () => {
    leave(openId)
    try {
      await queue.current
      const note = await saveNote({ text: '', updatedAt: Date.now() })
      play('add')
      setNotes((all) => [note, ...(all ?? [])])
      setOpenId(note.id)
      setFresh(note.id)
    } catch {
      toast('A new note could not be made.', { id: 'said' })
    }
  }

  const type = (text: string) => {
    if (openId === null) return
    const note = { id: openId, text, updatedAt: Date.now() }
    setNotes((all) => all && all.map((n) => (n.id === openId ? note : n)))
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { note, timer: setTimeout(flush, QUIET_MS) }
  }

  const remove = (note: Note) => {
    if (pending.current?.note.id === note.id) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    play('delete')
    setNotes((all) => all && all.filter((n) => n.id !== note.id))
    setOpenId(null)
    queue.current = queue.current.then(() => deleteNote(note.id))
    toast('Note deleted', {
      id: 'said',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          play('undo')
          // Saved again under its own id, so it comes back as it was.
          write(note)
          setNotes((all) => [note, ...(all ?? []).filter((n) => n.id !== note.id)])
          setOpenId(note.id)
        },
      },
    })
  }

  const sorted = notes ? [...notes].sort(byNewest) : []
  const current = sorted.find((n) => n.id === openId)
  const now = Date.now()
  const groups = groupByDate(
    sorted.filter((n) => matches(n, query)),
    now,
  )

  // On a phone: the open note alone, with a way back to the list.
  if (isMobile && current) {
    return (
      <div>
        <div className="mb-3 flex items-center">
          <Button variant="ghost" size="sm" className="-ml-2.5 text-primary" onClick={() => open(null)}>
            <ChevronLeftIcon />
            Notes
          </Button>
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Delete note" onClick={() => remove(current)}>
            <Trash2Icon />
          </Button>
        </div>
        <NoteText key={current.id} note={current} focused={current.id === fresh} onChange={type} />
      </div>
    )
  }

  return (
    <div>
      <ViewHeader title="Notes">
        {!isMobile && current && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete note"
            title="Delete note"
            onClick={() => remove(current)}
          >
            <Trash2Icon />
          </Button>
        )}
        <HeaderButton onClick={() => void create()}>
          <PlusIcon />
          New note
        </HeaderButton>
      </ViewHeader>
      {notes && notes.length === 0 && <p className="py-10 text-sm text-muted-foreground">No notes yet. New note starts one.</p>}
      {sorted.length > 0 && (
        <div className="flex items-start gap-8">
          {/* The list stays where it is while a long note scrolls past it. */}
          <div className="w-full shrink-0 md:sticky md:top-4 md:max-h-[calc(100svh-2rem)] md:w-64 md:overflow-y-auto">
            <label className="mb-3 flex h-8 items-center gap-2 rounded-lg bg-muted px-2.5 text-muted-foreground max-md:h-10">
              <SearchIcon className="size-4 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault()
                    setQuery('')
                  }
                }}
                placeholder="Search"
                aria-label="Search notes"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground max-md:text-base [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            {groups.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No notes match</p>}
            {groups.map((group) => (
              <section key={group.label} className="mb-3">
                <h2 className="px-3 pb-1 text-xs font-medium text-faint">{group.label}</h2>
                <ul aria-label={group.label}>
                  {group.notes.map((note) => (
                    <li key={note.id}>
                      <button
                        type="button"
                        onClick={() => open(note.id)}
                        aria-current={note.id === openId ? 'true' : undefined}
                        className={cn(
                          'flex w-full flex-col items-start rounded-lg px-3 py-2 text-left max-md:rounded-none max-md:border-b max-md:py-3',
                          note.id === openId ? 'bg-accent' : 'hover:bg-accent/60',
                        )}
                      >
                        <span className={cn('w-full truncate text-sm font-medium', isBlank(note.text) && 'text-muted-foreground')}>
                          {titleOf(note.text)}
                        </span>
                        <span className="text-xs text-muted-foreground">{whenText(note.updatedAt, now)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {!isMobile && current && (
            // As long as the note is: the page scrolls, not a box inside it.
            // Held to a readable line length.
            <div className="min-w-0 max-w-3xl flex-1">
              <NoteText key={current.id} note={current} focused={current.id === fresh} onChange={type} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// A note reads as formatted Markdown. A click on it (not on a link) edits
// the plain text, and leaving the field shows it formatted again. A note
// just made, or one with nothing in it yet, opens for typing.
function NoteText({ note, focused, onChange }: { note: Note; focused: boolean; onChange: (text: string) => void }) {
  const [editing, setEditing] = useState(focused || isBlank(note.text))
  const field = useRef<HTMLTextAreaElement>(null)
  // The field grows with the text, so a long note scrolls with the page
  // instead of inside a box of its own.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note.text, editing])
  if (editing) {
    return (
      <textarea
        ref={field}
        autoFocus
        aria-label="Note"
        value={note.text}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => !isBlank(note.text) && setEditing(false)}
        onKeyDown={(event) => {
          // Escape ends editing, as leaving the field does.
          if (event.key === 'Escape' && !isBlank(note.text)) {
            event.preventDefault()
            setEditing(false)
          }
        }}
        placeholder="Write it down… Markdown works: # Title, - list, **bold**"
        className="block min-h-[50svh] w-full resize-none overflow-hidden bg-transparent font-mono text-[14px] leading-relaxed outline-none placeholder:font-sans placeholder:text-faint max-md:text-base"
      />
    )
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Edit note"
      onClick={(event) => {
        if (!(event.target as Element).closest('a, input')) setEditing(true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          setEditing(true)
        }
      }}
      className="note-md min-h-[50svh] w-full cursor-text pb-16 text-[15px] leading-relaxed outline-none max-md:text-base"
    >
      <Markdown options={MARKDOWN}>{note.text}</Markdown>
    </div>
  )
}

// A link opens in the browser, never inside the app's window.
function NoteLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (href && /^https?:\/\//i.test(href)) openLink(href)
      }}
    >
      {children}
    </a>
  )
}

// Raw HTML in a note stays text: a note is for writing, not for markup that
// could run in the app.
const MARKDOWN = { disableParsingRawHTML: true, forceBlock: true, overrides: { a: NoteLink } }
