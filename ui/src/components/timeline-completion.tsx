import { useEffect, useState } from 'react'
import { EllipsisIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/app-context'
import { loadFinished } from '@/lib/backend'
import { TODAY } from '@/lib/days'
import { SYNCED } from '@/lib/store'
import { isSubtask, type Task } from '@/lib/tasks'
import { shownFor } from '@/lib/team'

const COMPLETED_KEY = 'done.timeline.completed'

function savedPreference() {
  try {
    return localStorage.getItem(COMPLETED_KEY) !== 'hidden'
  } catch {
    return true
  }
}

export function useTimelineCompletion() {
  const { data, me, scope, team } = useApp()
  const [showCompleted, setShow] = useState(savedPreference)
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
  if (!showCompleted) return { showCompleted, setShowCompleted, completed: [] as Task[] }

  // The current view is authoritative for open, reopened and today's tasks.
  const currentIds = new Set(data.tasks.map((task) => task.id))
  const stored = history?.account === me ? history.tasks : []
  const older = stored.filter((task) => task.doneDay !== TODAY && !currentIds.has(task.id))
  const recent = data.tasks.filter((task) => task.done)
  const scoped = shownFor({ projects: data.projects, tasks: [...recent, ...older] }, scope, team)
  const completed = scoped.tasks.filter((task) => task.doneDay && !isSubtask(task))
  return { showCompleted, setShowCompleted, completed }
}

export function TimelineCompletionOption({ showCompleted, setShowCompleted }: Pick<ReturnType<typeof useTimelineCompletion>, 'showCompleted' | 'setShowCompleted'>) {
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
      </PopoverContent>
    </Popover>
  )
}
