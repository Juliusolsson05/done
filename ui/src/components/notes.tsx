// Notes: press New note, type, and it is kept. For the list written down in
// the middle of a conversation that is not a task. The list on the left, the
// open note on the right; on a phone one at a time.
import { Fragment, useEffect, useRef, useState, type ReactNode, useMemo } from 'react'
import { inScope, spaceForNew } from '@/lib/team'
import Markdown from 'markdown-to-jsx/react'
import { BookOpenIcon, ChevronLeftIcon, FolderIcon, PenLineIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
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
import { SYNCED } from '@/lib/store'
import { FolderActions, FolderNav } from '@/components/note-folders'
import { publishFolderPanel } from '@/lib/note-folder-panel'
import {
  byNewest,
  cleanFolder,
  folderList,
  groupByDate,
  inFolder,
  isBlank,
  keepLineBreaks,
  matches,
  sameFolder,
  titleOf,
  whenText,
  withFolder,
  type Note,
} from '@/lib/notes'
import { linksIn } from '@/lib/links'
import { mentionId, mentionsIn } from '@/lib/mentions'
import { TaskMention } from '@/components/task-mention'
import { NoteRefs } from '@/components/note-refs'
import { NoteEditor } from '@/components/note-editor'
import { play } from '@/lib/sounds'
import { forgetLast, recordStep } from '@/lib/undo'
import { cn } from '@/lib/utils'

// How long typing has to pause before the note is written.
const QUIET_MS = 500

// Folders made on this device that no note is in yet. A folder is a name on
// its notes, so until one goes in it would vanish; it is kept here instead.
const KEPT_KEY = 'done-note-folders'
function storedKept(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEPT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function Notes() {
  const { ui, data, scope, team } = useApp()
  const isMobile = useIsMobile()
  const [stored, setNotes] = useState<Note[] | null>(null)
  // The notes of the space the picker is on. A note is where its project is,
  // else where it was written.
  const notes = useMemo(
    () =>
      stored &&
      stored.filter((n) => inScope(n.projectId != null ? (data.projects.find((p) => p.id === n.projectId)?.spaceId ?? n.spaceId) : n.spaceId, scope, team)),
    [stored, scope, team, data.projects],
  )
  const [openId, setOpenId] = useState<number | null>(null)
  // What is typed in the search field. Kept while notes are opened, so going
  // through the matches one by one does not lose it.
  const [query, setQuery] = useState('')
  // Reading: the open note shown formatted as a document, on its own, with
  // the list put away. Writing is always plain text.
  const [reading, setReading] = useState(false)
  // The note just made: its field opens with the cursor in it.
  const [fresh, setFresh] = useState<number | null>(null)
  // The folder chosen; null is All notes.
  const [folder, setFolder] = useState<string | null>(null)
  const [kept, setKeptState] = useState<string[]>(storedKept)
  // On a phone the folders come first; a tap on one goes on to its notes.
  const [atFolders, setAtFolders] = useState(true)
  // The note waiting to be written, and its timer. One at a time: switching
  // notes or leaving the page writes it at once.
  const pending = useRef<{ note: Note; timer: ReturnType<typeof setTimeout> } | null>(null)
  // Writes go one after another, so an older text can never land after a newer one.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef<Note[] | null>(null)
  latest.current = notes
  const openRef = useRef<number | null>(null)
  openRef.current = openId

  const setKept = (next: string[]) => {
    setKeptState(next)
    try {
      localStorage.setItem(KEPT_KEY, JSON.stringify(next))
    } catch {
      // Private windows may refuse storage; the folder still shows until a reload.
    }
  }

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
    // Notes written on another device, arriving by sync.
    window.addEventListener(SYNCED, reread)
    return () => {
      window.removeEventListener('focus', reread)
      window.removeEventListener(SYNCED, reread)
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

  // A note asked for from elsewhere (the search) is opened once it is here,
  // under All notes so it is listed whatever folder it is in.
  const asked = ui.view.kind === 'notes' ? ui.view.id : undefined
  useEffect(() => {
    if (asked !== undefined && notes?.some((n) => n.id === asked)) {
      setQuery('')
      setFolder(null)
      setAtFolders(false)
      open(asked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, notes !== null])

  // On a wide screen a note is always open when the chosen folder has one:
  // the one asked for if any, otherwise the folder's newest.
  useEffect(() => {
    if (isMobile || openId !== null || !notes) return
    const newest = [...notes].sort(byNewest).find((n) => inFolder(n, folder))
    if (asked !== undefined && notes.some((n) => n.id === asked)) setOpenId(asked)
    else if (newest) setOpenId(newest.id)
  }, [isMobile, openId, notes, asked, folder])

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

  // Choosing a folder: its notes are listed, and on a wide screen its newest
  // is opened, so the note on the right is always one of the folder's.
  const choose = (next: string | null) => {
    setFolder(next)
    setQuery('')
    setAtFolders(false)
    if (isMobile) return
    const newest = [...(latest.current ?? [])].sort(byNewest).find((n) => inFolder(n, next))
    open(newest ? newest.id : null)
  }

  // A new note goes in the folder that is open, so it is listed where it was made.
  const create = async (projectId: number | null = null, into: string | null = folder) => {
    setReading(false)
    leave(openId)
    try {
      await queue.current
      const note = await saveNote({ text: '', updatedAt: Date.now(), projectId, folder: into, spaceId: spaceForNew(scope) })
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
    // Built from the note it replaces, so its project and folder are kept:
    // a field left out here would be cleared by the next keystroke's save.
    const note: Note = { projectId: null, folder: null, ...was, id: openId, text, updatedAt: Date.now() }
    setNotes((all) => all && all.map((n) => (n.id === openId ? note : n)))
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { note, timer: setTimeout(flush, QUIET_MS) }
  }

  // Changes the open note's project or folder. Saved at once.
  const refileOpen = (fields: Partial<Pick<Note, 'projectId' | 'folder'>>) => {
    const was = latest.current?.find((n) => n.id === openId)
    if (!was) return
    if (pending.current) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    const note = { ...was, ...fields }
    play('confirm')
    setNotes((all) => all && all.map((n) => (n.id === note.id ? note : n)))
    write(note)
  }

  // Moves every note in folder `from` to `to` (none for null), writing each.
  // Returns the notes as they were, for Undo.
  const refileFolder = (from: string, to: string | null): Note[] => {
    flush()
    const all = latest.current ?? []
    const moved = withFolder(all, from, to)
    const before = all.filter((n) => moved.some((m) => m.id === n.id))
    setNotes((now) => now && now.map((n) => moved.find((m) => m.id === n.id) ?? n))
    for (const note of moved) write(note)
    return before
  }

  const folders = folderList(notes ?? [], kept)

  // A folder kept here while empty is forgotten once a note with something
  // in it is filed there: from then on the notes say it exists, and if it is
  // renamed or deleted on another device, this one follows instead of
  // holding on to the old name.
  useEffect(() => {
    if (!notes) return
    const stillEmpty = kept.filter((k) => !notes.some((n) => n.folder && sameFolder(n.folder, k) && !isBlank(n.text)))
    if (stillEmpty.length !== kept.length) setKept(stillEmpty)
    // Only when the notes change; kept is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes])

  const createFolder = (typed: string) => {
    const name = cleanFolder(typed)
    if (!name) return
    const existing = folders.find((f) => sameFolder(f.name, name))
    if (!existing) {
      play('add')
      setKept([...kept, name])
    }
    choose(existing ? existing.name : name)
  }

  const renameFolder = (from: string, typed: string) => {
    const to = cleanFolder(typed)
    if (!to || to === from) return
    play('confirm')
    refileFolder(from, to)
    setKept(kept.map((k) => (sameFolder(k, from) ? to : k)))
    if (folder !== null && sameFolder(folder, from)) setFolder(to)
  }

  // Deleting a folder never deletes a note: its notes are taken out of it.
  const deleteFolder = (name: string) => {
    const before = refileFolder(name, null)
    const wasKept = kept
    setKept(kept.filter((k) => !sameFolder(k, name)))
    setFolder(null)
    setAtFolders(true)
    play('delete')
    // Puts back only the folder, on each note as it is now: its text may
    // have changed since the folder was deleted, and Undo must not take that
    // typing back. A note deleted since stays deleted.
    const bringBack = () => {
      flush()
      const now = latest.current ?? []
      const restored = before.flatMap((b) => {
        const current = now.find((n) => n.id === b.id)
        return current ? [{ ...current, folder: b.folder }] : []
      })
      for (const note of restored) write(note)
      setNotes((all) => all && all.map((n) => restored.find((r) => r.id === n.id) ?? n))
      setKept(wasKept)
    }
    recordStep(bringBack)
    toast(before.length ? 'Folder deleted. Its notes are in All notes.' : 'Folder deleted', {
      id: 'said',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          play('undo')
          forgetLast()
          bringBack()
        },
      },
    })
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
  // A search looks through every note, as Apple Notes does; otherwise the
  // list is the chosen folder's.
  const searching = query.trim() !== ''
  const groups = groupByDate(
    sorted.filter((n) => (searching ? matches(n, query) : inFolder(n, folder))),
    now,
  )

  const projectPicker = current && (
    <Select value={String(current.projectId ?? 'none')} onValueChange={(value) => refileOpen({ projectId: value === 'none' ? null : Number(value) })}>
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

  // A select cannot have an empty value, so "no folder" has a name no folder
  // can have (a folder name never starts with a space).
  const NO_FOLDER = ' none'
  const folderPicker = current && (
    <Select
      value={folders.find((f) => current.folder && sameFolder(f.name, current.folder))?.name ?? NO_FOLDER}
      onValueChange={(value) => refileOpen({ folder: value === NO_FOLDER ? null : value })}
    >
      <SelectTrigger size="sm" aria-label="Folder" className="h-8 max-w-48 border-0 text-muted-foreground shadow-none hover:bg-accent">
        <FolderIcon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FOLDER}>No folder</SelectItem>
        {folders.map((f) => (
          <SelectItem key={f.name} value={f.name}>
            {f.name}
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
      aria-label={reading ? 'Back to writing' : 'Read as a document'}
      onClick={() => setReading((r) => !r)}
    >
      {reading ? <PenLineIcon /> : <BookOpenIcon />}
      {reading ? 'Edit' : 'Read'}
    </Button>
  )

  // The sidebar lists the folders under Notes while this page is open, and
  // acts on them through these. Published after every render, so it always
  // has the current folders and the current page's functions.
  useEffect(() => {
    publishFolderPanel({
      folders,
      total: notes?.length ?? 0,
      selected: folder,
      select: choose,
      create: createFolder,
      rename: renameFolder,
      remove: deleteFolder,
      newNote: (into) => {
        setFolder(into)
        void create(null, into)
      },
    })
  })
  useEffect(() => () => publishFolderPanel(null), [])


  // On a phone: the open note alone, with a way back to the list.
  if (isMobile && current) {
    return (
      <div>
        {/* On a phone the actions wrap under the way back rather than pushing
            the page wider than the screen (folder, project, Read and Delete
            do not fit one line at 393 points). */}
        <div className="mb-3 flex flex-wrap items-center gap-y-1">
          <Button variant="ghost" size="sm" className="-ml-2.5 max-w-40 text-primary" onClick={() => open(null)}>
            <ChevronLeftIcon />
            <span className="truncate">{folder ?? 'All notes'}</span>
          </Button>
          <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-1">
            {folderPicker}
            {projectPicker}
            {readToggle}
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Delete note" onClick={() => remove(current)}>
              <Trash2Icon />
            </Button>
          </div>
        </div>
        {reading ? <NoteDocument text={current.text} /> : <NoteText key={current.id} note={current} focused={current.id === fresh} onChange={type} />}
      </div>
    )
  }

  // On a phone, the folders come first, as in Apple Notes.
  if (isMobile && atFolders) {
    return (
      <div>
        <ViewHeader title="Notes">
          <HeaderButton onClick={() => void create(null)}>
            <PlusIcon />
            New note
          </HeaderButton>
        </ViewHeader>
        <FolderNav folders={folders} total={notes?.length ?? 0} onSelect={choose} onCreate={createFolder} />
      </div>
    )
  }

  const empty = groups.length === 0
  return (
    <div>
      {isMobile && (
        <Button
          variant="ghost"
          size="sm"
          className="mb-1 -ml-2.5 text-primary"
          onClick={() => {
            // Back on the folders, no folder is open, so New note there files
            // into none rather than the folder just left.
            setAtFolders(true)
            setFolder(null)
          }}
        >
          <ChevronLeftIcon />
          Folders
        </Button>
      )}
      {/* On a wide screen the folders are in the sidebar, so the title says which one is open. */}
      <ViewHeader title={folder ?? (isMobile ? 'All notes' : 'Notes')}>
        {isMobile && folder !== null && <FolderActions name={folder} onRename={renameFolder} onDelete={deleteFolder} />}
        {!isMobile && folderPicker}
        {!isMobile && projectPicker}
        {!isMobile && readToggle}
        {!isMobile && current && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete note"
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
      {notes && (
        <div className="flex items-start gap-6">
          {/* The folders and the list stay where they are while a long note scrolls past them. */}
          <div className={cn('w-full shrink-0 md:sticky md:top-4 md:max-h-[calc(100svh-2rem)] md:w-64 md:overflow-y-auto', reading && 'hidden')}>
            {notes.length > 0 && (
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
                  placeholder="Search all notes"
                  aria-label="Search notes"
                  className="border-transparent bg-muted pl-8 shadow-none focus-visible:border-transparent focus-visible:bg-muted/70 focus-visible:ring-0 dark:bg-muted [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
            )}
            {empty && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {searching ? 'No notes match' : notes.length === 0 ? 'No notes yet. New note starts one.' : 'No notes in this folder. New note starts one here.'}
              </p>
            )}
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
                          {/* Under All notes or a search, where a note is in is worth saying. */}
                          {note.folder && (folder === null || searching) && (
                            <>
                              <FolderIcon className="size-3" />
                              <span className="truncate">{note.folder}</span>
                            </>
                          )}
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
                <NoteDocument text={current.text} />
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
  const { data } = useApp()
  const links = linksIn(note.text)
  return (
    <div className="relative">
      <NoteRefs note={note.id} tasks={mentionsIn(note.text)} links={links} />
      <NoteEditor text={note.text} onChange={onChange} focused={focused} tasks={data.tasks} />
    </div>
  )
}

// The note shown formatted, as a document to read. Markdown: # headings,
// lists, **bold**, links and so on.
function NoteDocument({ text }: { text: string }) {
  // Reading only: clicking or selecting text never switches to writing, so a
  // passage can be selected and copied. Edit or Esc goes back.
  return (
    <article data-findable className={cn(DOCUMENT, 'pt-1 pb-24')}>
      <Markdown options={MARKDOWN}>{keepLineBreaks(text)}</Markdown>
    </article>
  )
}

// A link opens in the browser, never inside the app's window. A link to a
// task (done:task/<id>) is a mention and is drawn as the task; this is the
// only place a mention changes how a note is drawn: the Markdown parser has
// already found it as a link, and everything around it is drawn as before.
function NoteLink({ href, children }: { href?: string; children?: ReactNode }) {
  const mentioned = mentionId(href)
  if (mentioned !== null) return <TaskMention id={mentioned} fallback={children} />
  return (
    <a
      href={href}
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
// How the formatted document reads. Set for reading, not for density: a
// generous line height, room between paragraphs and list items, clear space
// above each heading, and a line length the eye can follow back.
const DOCUMENT = cn(
  'max-w-[68ch] text-[16px] leading-7 text-foreground/90 max-md:text-[17px]',
  // Blocks: a paragraph's worth of space between them.
  '[&>*+*]:mt-4',
  // Headings: space above sets each section apart; little below ties it to its text.
  '[&_h1]:text-[1.65rem] [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground',
  '[&_h2]:text-[1.2rem] [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:text-foreground [&>h2:not(:first-child)]:mt-9',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&>h3:not(:first-child)]:mt-7',
  '[&>h1+*]:mt-3 [&>h2+*]:mt-2.5 [&>h3+*]:mt-2',
  '[&_strong]:font-semibold [&_strong]:text-foreground [&_em]:text-muted-foreground',
  // Lists: each item gets its own line of air; the markers stay quiet.
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-7 [&_li]:pl-1 [&_li+li]:mt-2 [&_li]:marker:text-muted-foreground',
  '[&_li>ul]:mt-2 [&_li>ol]:mt-2',
  '[&_li:has(>input)]:-ml-6 [&_li:has(>input)]:list-none [&_input]:mr-2.5 [&_input]:align-middle',
  '[&_a]:underline [&_a]:decoration-primary/50 [&_a]:underline-offset-[3px] hover:[&_a]:decoration-primary',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:leading-6 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_hr]:my-8 [&_hr]:border-border',
  // Tables: light lines, a quiet header, room in each cell.
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-[15px] [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground',
  '[&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2',
)

// Raw HTML in a note stays text: a note is for writing, not for markup that
// could run in the app.
// No wrapper element: the blocks sit right in the article, so its spacing
// rules (paragraphs, space above headings) reach them.
export const MARKDOWN = { disableParsingRawHTML: true, forceBlock: true, wrapper: Fragment, overrides: { a: NoteLink } }
