// "What are you working on?": a button naming the chosen task, which opens a
// field to type into over the tasks worth focusing on. Which tasks, in what
// order and what a query finds is lib/focus-picker.ts; this draws it.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import { ProjectDot } from '@/components/marks'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsMobile, useIsTouch } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { loadEntries } from '@/lib/backend'
import { addDays, describeDay, TODAY } from '@/lib/days'
import { cursorAt, moveCursor, pickerGroups, recentTaskIds, type Cursor, type RowKey } from '@/lib/focus-picker'
import { goalTask, projectName, type Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// Never shorter than this, so a few rows always show even with the keyboard up.
const SHORTEST_LIST = 132
// How far back "Recent" looks.
const RECENT_DAYS = 7

// The project and due day under a title, so two tasks with near names can
// be told apart.
function TaskDetail({ task }: { task: Task }) {
  const { data } = useApp()
  const late = task.due !== null && task.due < TODAY
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <ProjectDot id={task.projectId} />
      <span className="truncate">{projectName(data.projects, task.projectId) || 'Inbox'}</span>
      {task.due && (
        <span className={cn('shrink-0 tabular-nums', late && 'text-overdue')}>
          <span aria-hidden>· </span>
          {describeDay(task.due, TODAY)}
        </span>
      )}
    </span>
  )
}

// The field and the list, the same in a popover and in a sheet.
function Finder({
  tasks,
  recent,
  goalId,
  chosen,
  onChoose,
  onClose,
}: {
  tasks: Task[]
  recent: number[]
  goalId: number | null
  chosen: number | null
  onChoose: (task: Task | null) => void
  onClose: () => void
}) {
  const { data } = useApp()
  const isTouch = useIsTouch()
  const id = useId()
  const [query, setQuery] = useState('')
  const typed = query.trim() !== ''
  const groups = pickerGroups({ tasks, projects: data.projects, today: TODAY, query, recent, goalId })
  // "Nothing in particular" leads the list until something is typed.
  const options: (Task | null)[] = [...(typed ? [] : [null]), ...groups.flatMap((g) => g.tasks)]
  const keys: RowKey[] = options.map((t) => t?.id ?? null)
  // Opens on the task already chosen, if it is still in the list.
  const [cursor, setCursor] = useState<Cursor>(() => (keys.includes(chosen) ? chosen : undefined))
  const at = cursorAt(keys, cursor)
  const list = useRef<HTMLUListElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // The list ends above the on-screen keyboard: iOS shrinks the visual
  // viewport for it, not the page, so nothing else on the page knows.
  useLayoutEffect(() => {
    const view = window.visualViewport
    const fit = () => {
      if (!list.current) return
      const bottom = view ? view.offsetTop + view.height : window.innerHeight
      setMaxHeight(Math.max(SHORTEST_LIST, Math.min(bottom - list.current.getBoundingClientRect().top - 12, 420)))
    }
    fit()
    // Measured again once the popover or sheet has slid into place: during
    // its opening animation the list is not yet where it ends up.
    const frame = requestAnimationFrame(fit)
    const settled = setTimeout(fit, 300)
    view?.addEventListener('resize', fit)
    view?.addEventListener('scroll', fit)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settled)
      view?.removeEventListener('resize', fit)
      view?.removeEventListener('scroll', fit)
    }
  }, [])

  // Named by the row's task, so the id always belongs to a row that exists.
  const optionId = (key: RowKey) => `${id}-option-${key ?? 'none'}`
  const onKeyDown = (event: KeyboardEvent) => {
    const step = ({ ArrowDown: 1, ArrowUp: -1 } as const)[event.key as 'ArrowDown' | 'ArrowUp']
    if (step) {
      event.preventDefault()
      setCursor(moveCursor(keys, cursor, step))
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setCursor(keys.length ? keys[event.key === 'Home' ? 0 : keys.length - 1] : undefined)
    }
    // Enter while composing (Japanese, Chinese input) accepts the word, not a row.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (at !== -1) onChoose(options[at])
    }
  }

  const row = (task: Task | null) => {
    const key = task?.id ?? null
    const active = keys[at] === key && at !== -1
    const selected = key === chosen
    return (
      <li
        key={key ?? 'nothing'}
        id={optionId(key)}
        role="option"
        aria-selected={selected}
        data-active={active}
        // Only a mouse moves the cursor by hovering; a finger scrolling
        // past rows must not.
        onPointerMove={(event) => event.pointerType === 'mouse' && setCursor(key)}
        onClick={() => onChoose(task)}
        className={cn(
          'flex min-h-11 cursor-default flex-col justify-center gap-0.5 rounded-md px-3 py-1.5 select-none',
          active && 'bg-accent',
          selected && 'font-medium',
        )}
      >
        {task ? (
          <>
            <span className="truncate text-sm">{task.title}</span>
            <TaskDetail task={task} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Nothing in particular</span>
        )}
      </li>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <label className="flex items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-label="Find a task"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={at !== -1 ? optionId(keys[at]) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            // A new query starts at its best match.
            setCursor(undefined)
          }}
          onKeyDown={onKeyDown}
          placeholder="Find a task or project"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          // 16px stops iOS zooming the page in on the field.
          className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {/* A finger has no Escape key, and tapping outside is not obvious. */}
        {isTouch && (
          <Button variant="ghost" className="-mr-2 min-h-11 text-muted-foreground" onClick={onClose}>
            Close
          </Button>
        )}
      </label>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Tasks" style={{ maxHeight }} className="overflow-y-auto overscroll-contain p-1">
        {options[0] === null && row(null)}
        {groups.map((group) =>
          group.heading ? (
            <li key={group.key} role="presentation">
              {/* Seen, not read: the group's label says it to a screen reader. */}
              <div aria-hidden className="px-3 pt-2.5 pb-1 text-xs font-medium text-faint">
                {group.heading}
              </div>
              <ul role="group" aria-label={group.heading}>
                {group.tasks.map(row)}
              </ul>
            </li>
          ) : (
            group.tasks.map(row)
          ),
        )}
      </ul>
      {/* Outside the list, which holds only options; said aloud when it appears. */}
      <p aria-live="polite" className={cn('px-3 text-center text-sm text-muted-foreground', options.length === 0 && 'py-6')}>
        {options.length === 0 ? 'Nothing matches' : ''}
      </p>
    </div>
  )
}

// The tasks focused on in the last week, from the time sheet: true on every
// device, where something kept in this window would not be. A day that fails
// to load just adds nothing.
function useRecent(): number[] {
  const [recent, setRecent] = useState<number[]>([])
  useEffect(() => {
    let live = true
    const days = Array.from({ length: RECENT_DAYS }, (_, i) => addDays(TODAY, -i))
    Promise.allSettled(days.map(loadEntries)).then((results) => {
      if (live) setRecent(recentTaskIds(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))))
    })
    return () => {
      live = false
    }
  }, [])
  return recent
}

// Reads the tasks, today's goal and what was focused on lately itself, so
// each place that asks for a task (the Focus page, Up next) passes only the
// choice.
export function FocusPicker({ id, chosen, onChoose }: { id: string; chosen: Task | null; onChoose: (task: Task | null) => void }) {
  const { shown, me } = useApp()
  const tasks = shown.tasks
  const recent = useRecent()
  const goal = goalTask(tasks, TODAY, me)
  const goalId = goal && !goal.done ? goal.id : null
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const choose = (task: Task | null) => {
    onChoose(task)
    setOpen(false)
  }

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      aria-expanded={open}
      className="h-auto min-h-11 w-full justify-between gap-3 px-3 py-1.5 text-left font-normal"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        {chosen ? (
          <>
            <span className="truncate">{chosen.title}</span>
            <TaskDetail task={chosen} />
          </>
        ) : (
          <span className="text-muted-foreground">Nothing in particular</span>
        )}
      </span>
      <ChevronDownIcon className="shrink-0 text-muted-foreground" />
    </Button>
  )
  const finder = () => (
    <Finder tasks={tasks} recent={recent} goalId={goalId} chosen={chosen?.id ?? null} onChoose={choose} onClose={() => setOpen(false)} />
  )

  // A phone gets a sheet from the top: the field is then above where the
  // keyboard comes up, whatever was scrolled where.
  if (isMobile)
    return (
      <>
        <Sheet open={open} onOpenChange={setOpen}>
          {/* As its trigger, the button gets the focus back when the sheet closes. */}
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="top" showCloseButton={false} className="gap-0 rounded-b-xl pt-[env(safe-area-inset-top)]">
            <SheetTitle className="sr-only">What are you working on?</SheetTitle>
            <SheetDescription className="sr-only">Type to find a task, then choose it.</SheetDescription>
            {finder()}
          </SheetContent>
        </Sheet>
      </>
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        // As wide as the button, and wide enough for a title on a narrow one.
        className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden p-0"
      >
        {finder()}
      </PopoverContent>
    </Popover>
  )
}
