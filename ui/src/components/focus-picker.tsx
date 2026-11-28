// "What are you working on?": a button naming the chosen task, which opens a
// field to type into over the tasks worth focusing on. Which tasks, in what
// order and what a query finds is lib/focus-picker.ts; this draws it.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import { ProjectDot } from '@/components/marks'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile, useIsTouch } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { describeDay, TODAY } from '@/lib/days'
import { pickerGroups } from '@/lib/focus-picker'
import { projectName, type Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// Never shorter than this, so a few rows always show even with the keyboard up.
const SHORTEST_LIST = 132

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
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      options.findIndex((t) => (t?.id ?? null) === chosen),
    ),
  )
  const list = useRef<HTMLUListElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

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
    view?.addEventListener('resize', fit)
    view?.addEventListener('scroll', fit)
    return () => {
      view?.removeEventListener('resize', fit)
      view?.removeEventListener('scroll', fit)
    }
  }, [])

  const optionId = (i: number) => `${id}-option-${i}`
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step) {
      event.preventDefault()
      if (options.length) setAt((i) => (i + step + options.length) % options.length)
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setAt(event.key === 'Home' ? 0 : options.length - 1)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (options.length) onChoose(options[at])
    }
  }

  let i = -1
  const row = (task: Task | null) => {
    i += 1
    const index = i
    const selected = (task?.id ?? null) === chosen
    return (
      <li
        key={task?.id ?? 'nothing'}
        id={optionId(index)}
        role="option"
        aria-selected={selected}
        data-active={index === at}
        // Only a mouse moves the cursor by hovering; a finger scrolling
        // past rows must not.
        onPointerMove={(event) => event.pointerType === 'mouse' && setAt(index)}
        onClick={() => onChoose(task)}
        className={cn(
          'flex min-h-11 cursor-default flex-col justify-center gap-0.5 rounded-md px-3 py-1.5 select-none',
          index === at && 'bg-accent',
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
          aria-activedescendant={options.length ? optionId(at) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            // A new query starts at its best match.
            setAt(0)
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
              <div id={`${id}-${group.key}`} className="px-3 pt-2.5 pb-1 text-xs font-medium text-faint">
                {group.heading}
              </div>
              <ul role="group" aria-labelledby={`${id}-${group.key}`}>
                {group.tasks.map(row)}
              </ul>
            </li>
          ) : (
            group.tasks.map(row)
          ),
        )}
        {options.length === 0 && (
          <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing matches
          </li>
        )}
      </ul>
    </div>
  )
}

export function FocusPicker({
  id,
  tasks,
  recent,
  goalId,
  chosen,
  onChoose,
}: {
  id: string
  tasks: Task[]
  recent: number[]
  goalId: number | null
  chosen: Task | null
  onChoose: (task: Task | null) => void
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const choose = (task: Task | null) => {
    onChoose(task)
    setOpen(false)
  }

  const trigger = (
    <Button
      id={id}
      variant="outline"
      aria-haspopup="listbox"
      aria-expanded={open}
      // In a popover, its trigger opens it; a sheet is opened here.
      onClick={isMobile ? () => setOpen(true) : undefined}
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
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
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
