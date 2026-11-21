// Search over the whole app, opened with Cmd+K (or Search in the sidebar):
// projects, tasks with their notes and subtasks, and notes. Arrow keys move,
// Enter opens, Escape closes.
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2Icon, CircleIcon, FolderIcon, NotebookPenIcon, SearchIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/app-context'
import { loadNotes } from '@/lib/backend'
import type { Note } from '@/lib/notes'
import { searchAll, type Hit } from '@/lib/search'
import { cn } from '@/lib/utils'

const HEADING: Record<Hit['kind'], string> = { project: 'Projects', task: 'Tasks', note: 'Notes' }

export function SearchDialog() {
  const { ui, data, closeAll, reveal } = useApp()
  const open = ui.searching
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  // Notes are read fresh each time the search opens; tasks are already here.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setAt(0)
    loadNotes().then(setNotes, () => setNotes([]))
  }, [open])

  const hits = searchAll(data, notes, query)

  useEffect(() => setAt(0), [query])
  useEffect(() => {
    list.current?.querySelector('[data-at="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const choose = (hit: Hit | undefined) => hit && reveal(hit)

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setAt((i) => (hits.length ? (i + step + hits.length) % hits.length : 0))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(hits[at])
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeAll()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <label className="flex items-center gap-3 border-b px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, notes and projects"
            aria-label="Search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
        {query.trim() !== '' && (
          <div ref={list} className="max-h-[min(60svh,28rem)] overflow-y-auto p-2">
            {hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches</p>}
            {hits.map((hit, i) => (
              <div key={`${hit.kind}-${hit.id}`}>
                {(i === 0 || hits[i - 1].kind !== hit.kind) && <p className="px-3 pt-2 pb-1 text-xs font-medium text-faint">{HEADING[hit.kind]}</p>}
                <button
                  type="button"
                  data-at={i === at}
                  onMouseMove={() => setAt(i)}
                  onClick={() => choose(hit)}
                  className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left', i === at && 'bg-accent')}
                >
                  <HitIcon hit={hit} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', hit.kind === 'task' && hit.done && 'text-muted-foreground line-through')}>
                      {hit.title}
                    </span>
                    {hit.detail && <span className="block truncate text-xs text-muted-foreground">{hit.detail}</span>}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function HitIcon({ hit }: { hit: Hit }) {
  const className = 'mt-0.5 size-4 shrink-0 text-muted-foreground'
  if (hit.kind === 'project') return <FolderIcon className={className} />
  if (hit.kind === 'note') return <NotebookPenIcon className={className} />
  return hit.done ? <CheckCircle2Icon className={className} /> : <CircleIcon className={className} />
}
