import { useEffect, useState } from 'react'
import { EllipsisIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/app-context'
import { loadFinished } from '@/lib/backend'
import { TODAY } from '@/lib/days'
import { SYNCED } from '@/lib/store'
import { isSubtask, type Task } from '@/lib/tasks'
import { shownFor } from '@/lib/team'

const COMPLETED_KEY = 'done.timeline.completed'
// Off unless chosen: tasks wholly in the past are hidden (lib/timeline-past).
const PAST_KEY = 'done.timeline.past'

function savedCompleted() {
  try {
    return localStorage.getItem(COMPLETED_KEY) === 'shown'
  } catch {
    return false
  }
}
function savedPast() {
  try {
    return localStorage.getItem(PAST_KEY) === 'hidden'
  } catch {
    return false
  }
}

export function useTimelineCompletion() {
  const { data, me, scope, team } = useApp()
  const [showCompleted, setShow] = useState(savedCompleted)
  const [hidePast, setHide] = useState(savedPast)
  const [history, setHistory] = useState<{ account: string | null; tasks: Task[] }>()
  useEffect(() => {
    if (!showCompleted) return
    let request = 0
    const read = () => {
      const next = ++request
      loadFinished().then((tasks) => {
        if (next === request) setHistory({ account: me, tasks })
      }, () => {
        // Recent work remains available from the state while offline.
      })
    }
    read()
    window.addEventListener('focus', read)
    window.addEventListener(SYNCED, read)
    return () => {
      request++
      window.removeEventListener('focus', read)
      window.removeEventListener(SYNCED, read)
    }
  }, [data.rev, me, showCompleted])

  const setShowCompleted = (show: boolean) => {
    setShow(show)
    try {
      localStorage.setItem(COMPLETED_KEY, show ? 'shown' : 'hidden')
    } catch {
      // Keep the preference for this visit.
    }
  }
  const setHidePast = (hide: boolean) => {
    setHide(hide)
    try {
      localStorage.setItem(PAST_KEY, hide ? 'hidden' : 'shown')
    } catch {
      // Keep the preference for this visit.
    }
  }
  if (!showCompleted) return { showCompleted, setShowCompleted, hidePast, setHidePast, completed: [] as Task[] }

  // The current view is authoritative for open, reopened and today's tasks.
  const currentIds = new Set(data.tasks.map((task) => task.id))
  const stored = history?.account === me ? history.tasks : []
  const older = stored.filter((task) => task.doneDay !== TODAY && !currentIds.has(task.id))
  const recent = data.tasks.filter((task) => task.done)
  const scoped = shownFor({ projects: data.projects, tasks: [...recent, ...older] }, scope, team)
  const completed = scoped.tasks.filter((task) => task.doneDay && !isSubtask(task))
  return { showCompleted, setShowCompleted, hidePast, setHidePast, completed }
}

type Options = Pick<ReturnType<typeof useTimelineCompletion>, 'showCompleted' | 'setShowCompleted' | 'hidePast' | 'setHidePast'>

export function TimelineCompletionOption({ showCompleted, setShowCompleted, hidePast, setHidePast }: Options) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More timeline options" title="More timeline options" className="text-muted-foreground pointer-coarse:size-11">
          <EllipsisIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Timeline options" className="w-44 p-1">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent">
          <input type="checkbox" className="size-4 accent-primary" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />
          Show completed
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent">
          <input type="checkbox" className="size-4 accent-primary" checked={hidePast} onChange={(event) => setHidePast(event.target.checked)} />
          Hide past tasks
        </label>
      </PopoverContent>
    </Popover>
  )
}

// Under the header while past tasks are hidden, so a missing task is explained
// and one press brings it back. Set as the filter bar's chips are.
export function PastHiddenChip({ setHidePast }: Pick<Options, 'setHidePast'>) {
  return (
    <span className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs">
      Past hidden
      <button
        type="button"
        aria-label="Show past tasks"
        title="Show past tasks"
        onClick={() => setHidePast(false)}
        className="relative rounded-full p-0.5 text-muted-foreground after:absolute after:-inset-1.5 hover:bg-accent hover:text-foreground pointer-coarse:after:-inset-3"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}
