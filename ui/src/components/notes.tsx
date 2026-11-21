// Notes: press New note, type, and it is kept. For the list written down in
// the middle of a conversation that is not a task. The list on the left, the
// open note on the right; on a phone one at a time.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Markdown from 'markdown-to-jsx/react'
import { BookOpenIcon, ChevronLeftIcon, ExternalLinkIcon, PenLineIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { useIsMobile } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { ProjectDot } from '@/components/marks'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { projectName } from '@/lib/tasks'
import { deleteNote, loadNotes, openLink, saveNote } from '@/lib/backend'
import { byNewest, groupByDate, isBlank, matches, titleOf, whenText, type Note } from '@/lib/notes'
import { label, linkAt, linksIn } from '@/lib/links'
import { play } from '@/lib/sounds'
import { forgetLast, recordStep } from '@/lib/undo'
import { cn } from '@/lib/utils'

// How long typing has to pause before the note is written.
const QUIET_MS = 500

export function Notes() {
  const { ui, data } = useApp()
  const isMobile = useIsMobile()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  // What is typed in the search field. Kept while notes are opened, so going
  // through the matches one by one does not lose it.
  const [query, setQuery] = useState('')
  // Reading: the open note shown formatted as a document, on its own, with
  // the list put away. Writing is always plain text.
  const [reading, setReading] = useState(false)
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
    loadNotes().then(
      (all) => {
        // An empty note left behind (the app was closed while it was open) is
        // cleared away, as leaving it would have done.
        const empty = all.filter((n) => isBlank(n.text) && n.id !== openRef.current)
        for (const n of empty) void deleteNote(n.id).catch(() => undefined)
        setNotes(all.filter((n) => !empty.includes(n)))
      },
      () => setNotes((all) => all ?? []),
    )
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

  // A note asked for from elsewhere (the search) is opened once it is here.
  const asked = ui.view.kind === 'notes' ? ui.view.id : undefined
  useEffect(() => {
    if (asked !== undefined && notes?.some((n) => n.id === asked)) {
      setQuery('')
      open(asked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, notes !== null])

  // "New note" pressed on a project's page: a note started in that project.
  const newIn = ui.view.kind === 'notes' ? ui.view.newIn : undefined
  const startedIn = useRef<object | null>(null)
  useEffect(() => {
    if (newIn === undefined || notes === null || startedIn.current === ui.view) return
    startedIn.current = ui.view
    void create(newIn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIn, notes !== null, ui.view])

  // On a wide screen a note is always open when there is one: the one asked
  // for if any, otherwise the newest.
  useEffect(() => {
    if (isMobile || openId !== null || !notes || notes.length === 0) return
    setOpenId(asked !== undefined && notes.some((n) => n.id === asked) ? asked : [...notes].sort(byNewest)[0].id)
  }, [isMobile, openId, notes, asked])

  useEffect(() => {
    if (!reading) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReading(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [reading])

  const open = (id: number | null) => {
    setReading(false)
    if (id === openId) return
    leave(openId)
    setOpenId(id)
  }

  const create = async (projectId: number | null = null) => {
    setReading(false)
    leave(openId)
    try {
      await queue.current
      const note = await saveNote({ text: '', updatedAt: Date.now(), projectId })
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
    const was = latest.current?.find((n) => n.id === openId)
    const note = { id: openId, text, updatedAt: Date.now(), projectId: was?.projectId ?? null }
    setNotes((all) => all && all.map((n) => (n.id === openId ? note : n)))
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { note, timer: setTimeout(flush, QUIET_MS) }
  }

  // Puts the open note in a project, or takes it out of one. Saved at once.
  const moveTo = (projectId: number | null) => {
    const was = latest.current?.find((n) => n.id === openId)
    if (!was) return
    if (pending.current) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    const note = { ...was, projectId }
    play('confirm')
    setNotes((all) => all && all.map((n) => (n.id === note.id ? note : n)))
    write(note)
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
    // Saved again under its own id, so it comes back as it was.
    const bringBack = () => {
      write(note)
      setNotes((all) => [note, ...(all ?? []).filter((n) => n.id !== note.id)])
      setOpenId(note.id)
    }
    recordStep(bringBack)
    toast('Note deleted', {
      id: 'said',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          play('undo')
          // The same step Cmd+Z would undo; it is done here instead.
          forgetLast()
          bringBack()
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

  const projectPicker = current && (
    <Select value={String(current.projectId ?? 'none')} onValueChange={(value) => moveTo(value === 'none' ? null : Number(value))}>
      <SelectTrigger size="sm" aria-label="Project" className="h-8 border-0 text-muted-foreground shadow-none hover:bg-accent">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">
          <ProjectDot id={null} />
          No project
        </SelectItem>
        {data.projects.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            <ProjectDot id={p.id} />
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const readToggle = current && !isBlank(current.text) && (
    <Button
      variant={reading ? 'secondary' : 'ghost'}
      size="sm"
      className={reading ? 'text-foreground' : 'text-muted-foreground'}
      aria-pressed={reading}
      title={reading ? 'Back to writing (Esc, or click the text)' : 'Read it as a formatted document'}
      onClick={() => setReading((r) => !r)}
    >
      {reading ? <PenLineIcon /> : <BookOpenIcon />}
      {reading ? 'Edit' : 'Read'}
    </Button>
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
          <div className="ml-auto flex gap-1">
            {projectPicker}
            {readToggle}
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Delete note" onClick={() => remove(current)}>
              <Trash2Icon />
            </Button>
          </div>
        </div>
        {reading ? (
          <NoteDocument text={current.text} onEdit={() => setReading(false)} />
        ) : (
          <NoteText key={current.id} note={current} focused={current.id === fresh} onChange={type} />
        )}
      </div>
    )
  }

  return (
    <div>
      <ViewHeader title="Notes">
        {!isMobile && projectPicker}
        {!isMobile && readToggle}
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
        <HeaderButton onClick={() => void create(null)}>
          <PlusIcon />
          New note
        </HeaderButton>
      </ViewHeader>
      {notes && notes.length === 0 && <p className="py-10 text-sm text-muted-foreground">No notes yet. New note starts one.</p>}
      {sorted.length > 0 && (
        <div className="flex items-start gap-8">
          {/* The list stays where it is while a long note scrolls past it. */}
          <div className={cn('w-full shrink-0 md:sticky md:top-4 md:max-h-[calc(100svh-2rem)] md:w-64 md:overflow-y-auto', reading && 'hidden')}>
            <div className="relative mb-4">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault()
                    setQuery('')
                  }
                }}
                placeholder="Search notes"
                aria-label="Search notes"
                className="border-transparent bg-muted pl-8 shadow-none focus-visible:border-transparent focus-visible:bg-muted/70 focus-visible:ring-0 dark:bg-muted [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            {groups.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No notes match</p>}
            {groups.map((group) => (
              <section key={group.label} className="mb-3">
                <h2 className="px-3 pb-1 text-xs font-semibold text-muted-foreground">{group.label}</h2>
                <ul aria-label={group.label} className="flex flex-col gap-0.5">
                  {group.notes.map((note) => (
                    <li key={note.id}>
                      <Button
                        variant="ghost"
                        onClick={() => open(note.id)}
                        aria-current={note.id === openId ? 'true' : undefined}
                        className={cn(
                          'h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left font-normal whitespace-normal max-md:py-3',
                          note.id === openId && 'bg-primary/10 hover:bg-primary/10',
                        )}
                      >
                        <span
                          data-findable
                          className={cn('w-full truncate text-sm font-medium', isBlank(note.text) ? 'text-muted-foreground' : 'text-foreground')}
                        >
                          {titleOf(note.text)}
                        </span>
                        <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                          {whenText(note.updatedAt, now)}
                          {note.projectId != null && (
                            <>
                              <ProjectDot id={note.projectId} className="size-1.5" />
                              <span className="truncate">{projectName(data.projects, note.projectId)}</span>
                            </>
                          )}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {!isMobile && current && (
            // As long as the note is: the page scrolls, not a box inside it.
            // Held to a readable line length.
            <div className={cn('min-w-0 max-w-3xl flex-1', reading && 'mx-auto')}>
              {reading ? (
                <NoteDocument text={current.text} onEdit={() => setReading(false)} />
              ) : (
                <NoteText key={current.id} note={current} focused={current.id === fresh} onChange={type} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// The note's text, always ready for typing. It grows with the text, so a
// long note scrolls with the page instead of inside a box of its own.
function NoteText({ note, focused, onChange }: { note: Note; focused: boolean; onChange: (text: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note.text])
  const links = linksIn(note.text)
  return (
    <>
      {/* The note's links, to open with one click while writing. */}
      {links.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {links.map((href) => (
            <Button key={href} variant="outline" size="xs" title={href} onClick={() => openLink(href)} className="font-normal text-muted-foreground">
              <ExternalLinkIcon />
              {label(href)}
            </Button>
          ))}
        </div>
      )}
      <textarea
        ref={field}
        autoFocus={focused}
        aria-label="Note"
        title="⌘-click a link to open it"
        value={note.text}
        onChange={(event) => onChange(event.target.value)}
        // Cmd-click on an address opens it, as in a code editor; a plain
        // click places the caret as usual.
        onClick={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return
          const href = linkAt(note.text, event.currentTarget.selectionStart)
          if (href) {
            event.preventDefault()
            openLink(href)
          }
        }}
        placeholder="Write it down…"
        className="block min-h-[50svh] w-full resize-none overflow-hidden bg-transparent pb-16 text-[15px] leading-relaxed outline-none placeholder:text-faint max-md:text-base"
      />
    </>
  )
}

// The note shown formatted, as a document to read. Markdown: # headings,
// lists, **bold**, links and so on.
// A click on the text (not on a link) goes back to writing.
function NoteDocument({ text, onEdit }: { text: string; onEdit: () => void }) {
  return (
    <article
      title="Click to edit"
      onClick={(event) => {
        if (!(event.target as Element).closest('a')) onEdit()
      }}
      data-findable
      className={cn(DOCUMENT, 'cursor-text pb-16 text-[15px] leading-relaxed max-md:text-base')}
    >
      <Markdown options={MARKDOWN}>{text}</Markdown>
    </article>
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
        if (href && /^https?:\/\//i.test(href)) openLink(href)
      }}
    >
      {children}
    </a>
  )
}

// How the formatted document looks, with the theme's own tokens.
const DOCUMENT = cn(
  '[&>*+*]:mt-2.5 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li>ul]:mt-1 [&_li>ol]:mt-1',
  '[&_li:has(>input)]:-ml-5 [&_li:has(>input)]:list-none [&_input]:mr-2 [&_input]:align-middle',
  '[&_a]:underline [&_a]:decoration-muted-foreground/50 [&_a]:underline-offset-2 hover:[&_a]:decoration-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:border-border',
  '[&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
)

// Raw HTML in a note stays text: a note is for writing, not for markup that
// could run in the app.
const MARKDOWN = { disableParsingRawHTML: true, forceBlock: true, overrides: { a: NoteLink } }
