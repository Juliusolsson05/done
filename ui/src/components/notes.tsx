// Notes: press New note, type, and it is kept. For the list written down in
// the middle of a conversation that is not a task. The list on the left, the
// open note on the right; on a phone one at a time.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { useIsMobile } from '@/hooks/use-mobile'
import { deleteNote, loadNotes, saveNote } from '@/lib/backend'
import { byNewest, isBlank, titleOf, whenText, type Note } from '@/lib/notes'
import { play } from '@/lib/sounds'
import { cn } from '@/lib/utils'

// How long typing has to pause before the note is written.
const QUIET_MS = 500

export function Notes() {
  const isMobile = useIsMobile()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
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

  // On a phone: the open note alone, with a way back to the list.
  if (isMobile && current) {
    return (
      <div className="flex min-h-[70svh] flex-col">
        <div className="mb-3 flex items-center">
          <Button variant="ghost" size="sm" className="-ml-2.5 text-primary" onClick={() => open(null)}>
            <ChevronLeftIcon />
            Notes
          </Button>
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Delete note" onClick={() => remove(current)}>
            <Trash2Icon />
          </Button>
        </div>
        <NoteText note={current} focused={current.id === fresh} onChange={type} />
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <ViewHeader title="Notes">
        <HeaderButton onClick={() => void create()}>
          <PlusIcon />
          New note
        </HeaderButton>
      </ViewHeader>
      {notes && notes.length === 0 && <p className="py-10 text-sm text-muted-foreground">No notes yet. New note starts one.</p>}
      {sorted.length > 0 && (
        <div className="flex gap-6">
          <ul className="w-full shrink-0 md:w-60" aria-label="Notes">
            {sorted.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => open(note.id)}
                  aria-current={note.id === openId ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col items-start rounded-lg px-3 py-2 text-left max-md:border-b max-md:rounded-none max-md:py-3',
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
          {!isMobile && current && (
            <div className="flex min-h-[60svh] min-w-0 flex-1 flex-col">
              <NoteText note={current} focused={current.id === fresh} onChange={type} />
              <div className="mt-2 flex justify-end">
                <HeaderButton danger onClick={() => remove(current)}>
                  <Trash2Icon />
                  Delete
                </HeaderButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NoteText({ note, focused, onChange }: { note: Note; focused: boolean; onChange: (text: string) => void }) {
  return (
    <textarea
      autoFocus={focused}
      // A fresh field per note, so the cursor and undo history do not carry over.
      key={note.id}
      aria-label="Note"
      value={note.text}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Write it down…"
      className="min-h-0 w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-faint max-md:text-base"
    />
  )
}
