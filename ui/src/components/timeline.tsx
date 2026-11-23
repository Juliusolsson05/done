// Timeline: the coming weeks as a grid of days, one row per task. shadcn has
// no such component, so the grid is plain elements; its controls are not.
import { useLayoutEffect, useRef, useState, type PointerEvent, type UIEvent } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { PriorityDot, ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { TaskCheck, useFinish } from '@/components/task-row'
import { projectStyle, useApp } from '@/lib/app-context'
import { addDays, daysBetween, fullDay, shortDay, toDate, TODAY, type Day } from '@/lib/days'
import { play } from '@/lib/sounds'
import { dragBar, isSubtask, patchTask, timelineGroups, type DragMode, type Task, type TimelineOrder } from '@/lib/tasks'
import { isFiltering, matchesFilter } from '@/lib/view-filter'
import { FilterBar, FilterButton, NothingMatches, useViewFilter } from '@/components/view-filter'
import { cn } from '@/lib/utils'
import { around, grown, NEAR, onScreen, reaching, type Span } from '@/lib/timeline-window'

// The width of one day in pixels. Every left and width below is a number of
// days times this, which is why they are style props and not classes.
const DAY_WIDTH = 38

// Measures a title, to know whether it fits inside its bar.
let ruler: CanvasRenderingContext2D | null = null
function textWidth(text: string): number {
  ruler ??= document.createElement('canvas').getContext('2d')
  if (!ruler) return 0
  ruler.font = '500 12px -apple-system, system-ui, sans-serif'
  return ruler.measureText(text).width
}

// The order is a habit of the person, not of the moment, so it is
// remembered on this device. Anything else in storage means the default.
const ORDER_KEY = 'done-timeline-group'
function storedOrder(): TimelineOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === 'date' ? 'date' : 'project'
  } catch {
    return 'project'
  }
}

interface Drag {
  id: number
  mode: DragMode
  // Where the pointer went down, and how many days the bar has moved since.
  x: number
  days: number
  // The bar's length in days when the drag began.
  length: number
}

function Row({
  task,
  days,
  drag,
  bar,
  showProject,
  showDay,
}: {
  task: Task
  days: Day[]
  drag: Drag | null
  bar: BarHandlers
  showProject: boolean
  // Scrolls the timeline to a day, drawing further back first if needed.
  showDay: (day: Day) => void
}) {
  const { data, noticed, edit, update } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const first = task.start ?? task.due
  const moved = drag?.id === task.id ? drag : null

  let track
  if (task.due && first && task.due < days[0]) {
    // Over before the first day drawn: a mark at the edge that goes there.
    const due = task.due
    track = (
      <button
        type="button"
        onClick={() => showDay(first)}
        title={`${task.title}, ${shortDay(first)} to ${shortDay(due)}. Show it`}
        className="absolute top-1.5 left-1 z-10 flex h-6 items-center gap-1 rounded-md border border-dashed border-input bg-background px-2 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
      >
        <ChevronLeftIcon className="size-3.5" />
        Ended {shortDay(due)}
      </button>
    )
  } else if (task.due && first) {
    let left = daysBetween(days[0], first) * DAY_WIDTH + 2
    let width = (daysBetween(first, task.due) + 1) * DAY_WIDTH - 4
    // Began before the first day drawn: cut at the edge, with a way back to its start.
    const cut = left < 2
    if (cut) {
      width += left - 2
      left = 2
    }
    // The bar follows the pointer while it is down; the task itself only
    // changes on release, so a drag is one change.
    if (moved && moved.mode !== 'end') left += moved.days * DAY_WIDTH
    if (moved?.mode === 'end') width += moved.days * DAY_WIDTH
    if (moved?.mode === 'start') width -= moved.days * DAY_WIDTH
    const fits = textWidth(task.title) + (task.priority < 4 ? 13 : 0) + 22 <= width
    track = (
      <div
        title={task.title}
        style={{ ...projectStyle(data.projects, task.projectId), left, width }}
        className={cn(
          'absolute top-1.5 z-10 flex h-6 cursor-grab touch-none items-center gap-1.5 rounded-md border border-project-edge bg-project-tint px-2 text-xs font-medium whitespace-nowrap select-none',
          task.due < TODAY && 'border-overdue',
          cut && 'rounded-l-none',
          moved && moved.days !== 0 && 'z-20 cursor-grabbing shadow-md',
          noticed === task.id && 'animate-noticed',
        )}
        onPointerDown={(e) => bar.down(e, task)}
        onPointerMove={bar.move}
        onPointerUp={(e) => bar.up(e, task)}
        onPointerCancel={bar.cancel}
      >
        {cut ? (
          <button
            type="button"
            aria-label={`Began ${shortDay(first)}. Show where it began`}
            title={`Began ${shortDay(first)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => showDay(first)}
            className="-ml-1.5 grid h-5 w-4 shrink-0 place-content-center rounded-sm text-muted-foreground hover:bg-background/70 hover:text-foreground"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
        ) : (
          <span data-grip="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" />
        )}
        <PriorityDot priority={task.priority} />
        {/* A bar too short for its title shows the title beside it, in full. */}
        <span data-findable className={cn('pointer-events-none', !fits && 'absolute top-1/2 left-full ml-2 -translate-y-1/2 font-normal')}>{task.title}</span>
        <span data-grip="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />
      </div>
    )
  } else {
    // No date yet: every day in the row is a button that sets it.
    track = days.map((day, i) => (
      <Button
        key={day}
        variant="ghost"
        aria-label={`Set ${task.title} to ${fullDay(day)}`}
        style={{ left: i * DAY_WIDTH + 2, width: DAY_WIDTH - 4 }}
        className="absolute top-1.5 h-6 rounded-md p-0 hover:bg-secondary"
        onClick={() => {
          play('confirm')
          update((d) => patchTask(d, task.id, { start: null, due: day }), task.id)
        }}
      />
    ))
  }

  return (
    <div data-task={task.id} className={cn('relative flex h-9', leaving && 'opacity-0 transition-opacity delay-150 duration-150')}>
      <div className="sticky left-0 z-30 flex w-64 shrink-0 max-md:w-36 items-center gap-2.5 border-r bg-background px-3">
        <TaskCheck task={task} checked={leaving} onChange={finish} />
        {/* By date, projects are mixed in one list, so each row says its own. */}
        {showProject && <ProjectDot id={task.projectId} className="shrink-0" />}
        <Button
          variant="ghost"
          onClick={() => edit(task.id)}
          className={cn('h-auto min-w-0 flex-1 justify-start rounded-none p-0 font-normal hover:bg-transparent', leaving && 'text-faint line-through')}
        >
          <span data-findable className="truncate">{task.title}</span>
        </Button>
      </div>
      <div className="relative shrink-0 overflow-hidden" style={{ width: days.length * DAY_WIDTH }}>
        {track}
      </div>
    </div>
  )
}

interface BarHandlers {
  down(event: PointerEvent<HTMLDivElement>, task: Task): void
  move(event: PointerEvent<HTMLDivElement>): void
  up(event: PointerEvent<HTMLDivElement>, task: Task): void
  cancel(): void
}

export function Timeline() {
  const { ui, dragging, edit, update, shown: inScope, me } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The days drawn: they grow as far back and forward as one scrolls (lib/timeline-window).
  const [span, setSpan] = useState<Span>(() => around(ui.tlStart))
  const days = Array.from({ length: span.days }, (_, i) => addDays(span.start, i))
  const width = span.days * DAY_WIDTH
  // Days put in front since the last drawing, to move the scroll by; and a
  // day to bring into view once drawn.
  const shift = useRef(0)
  const goTo = useRef<Day | null>(null)
  // Where the scroll is, in days from the first drawn, and how many show.
  const view = () => {
    const el = scroller.current
    if (!el) return { left: 0, width: 0 }
    return { left: el.scrollLeft / DAY_WIDTH, width: (el.clientWidth - (label.current?.offsetWidth ?? 0)) / DAY_WIDTH }
  }
  const [range, setRange] = useState<[Day, Day]>(() => onScreen(span, NEAR, 30))
  // First drawing: the usual first day at the left edge, with weeks before it to scroll back into.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = daysBetween(span.start, ui.tlStart) * DAY_WIDTH
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (shift.current) {
      // Days were put in front: move by as much, so nothing on screen moves.
      el.scrollLeft += shift.current * DAY_WIDTH
      shift.current = 0
    }
    if (goTo.current) {
      el.scrollTo({ left: (daysBetween(span.start, goTo.current) - NEAR) * DAY_WIDTH, behavior: 'smooth' })
      goTo.current = null
    }
    const { left, width } = view()
    setRange(onScreen(span, left, width))
  }, [span])
  const onScroll = (_: UIEvent<HTMLDivElement>) => {
    const { left, width } = view()
    const next = grown(span, left, width)
    setRange(onScreen(span, left, width))
    if (next.span.days === span.days) return
    shift.current += next.shift
    setSpan(next.span)
  }
  const showDay = (day: Day) => {
    const next = reaching(span, day)
    shift.current += next.shift
    goTo.current = day
    if (next.shift) setSpan(next.span)
    else scroller.current?.scrollTo({ left: (daysBetween(span.start, day) - NEAR) * DAY_WIDTH, behavior: 'smooth' })
  }
  const byWeek = (weeks: number) => scroller.current?.scrollBy({ left: weeks * 7 * DAY_WIDTH, behavior: 'smooth' })
  const [order, setOrderState] = useState(storedOrder)
  const setOrder = (next: TimelineOrder) => {
    setOrderState(next)
    try {
      localStorage.setItem(ORDER_KEY, next)
    } catch {
      // Private windows may refuse storage; the order still applies for now.
    }
  }
  // The filter only changes what is drawn; see lib/view-filter.
  const filter = useViewFilter()
  const groups = timelineGroups(
    inScope.projects,
    inScope.tasks.filter((t) => isSubtask(t) || matchesFilter(t, filter, TODAY, me)),
    order,
  )
  const shown = groups.reduce((n, g) => n + g.tasks.length, 0)
  const total = timelineGroups(inScope.projects, inScope.tasks, order).reduce((n, g) => n + g.tasks.length, 0)

  // How many whole days the pointer is from where it went down.
  const daysMoved = (from: Drag, x: number) => {
    const moved = Math.round((x - from.x) / DAY_WIDTH)
    // An end can be dragged up to the other end, never past it.
    if (from.mode === 'end') return Math.max(moved, 1 - from.length)
    if (from.mode === 'start') return Math.min(moved, from.length - 1)
    return moved
  }
  const stop = () => {
    setDrag(null)
    dragging.current = false
  }
  const bar: BarHandlers = {
    down(event, task) {
      if (event.button !== 0 || !task.due) return
      const grip = (event.target as HTMLElement).dataset.grip
      const mode: DragMode = grip === 'start' || grip === 'end' ? grip : 'move'
      setDrag({ id: task.id, mode, x: event.clientX, days: 0, length: daysBetween(task.start ?? task.due, task.due) + 1 })
      dragging.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    move(event) {
      if (drag) setDrag({ ...drag, days: daysMoved(drag, event.clientX) })
    },
    up(event, task) {
      if (!drag) return
      const moved = daysMoved(drag, event.clientX)
      stop()
      // A press without movement is a click: open the task.
      if (moved === 0) return edit(task.id)
      play('drop')
      update((d) => patchTask(d, task.id, dragBar(task, drag.mode, moved)), task.id)
    },
    cancel: stop,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title="Timeline" sub={`${shortDay(range[0])} to ${shortDay(range[1])}`}>
        <Select value={order} onValueChange={(value) => setOrder(value as TimelineOrder)}>
          <SelectTrigger size="sm" aria-label="Group by" className="h-8 border-0 text-muted-foreground shadow-none hover:bg-accent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="project">Project first</SelectItem>
            <SelectItem value="date">Date first</SelectItem>
          </SelectContent>
        </Select>
        <HeaderButton onClick={() => byWeek(-1)}>Earlier</HeaderButton>
        <HeaderButton onClick={() => showDay(addDays(TODAY, -4 + NEAR))}>Today</HeaderButton>
        <HeaderButton onClick={() => byWeek(1)}>Later</HeaderButton>
        <FilterButton />
      </ViewHeader>
      <FilterBar shown={shown} total={total} />

      {isFiltering(filter) && shown === 0 ? (
        <NothingMatches />
      ) : (
      <div ref={scroller} onScroll={onScroll} className="min-h-0 overflow-auto overscroll-x-contain rounded-xl border">
        <div className="relative w-max min-w-full">
          {/* The day columns behind every row: weekends shaded, today marked. */}
          <div className="pointer-events-none absolute inset-y-0 left-64 max-md:left-36" style={{ width }}>
            {days.map((day, i) => {
              const weekday = toDate(day).getDay()
              return (
                <div
                  key={day}
                  style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                  className={cn(
                    'absolute inset-y-0 border-l border-border/60',
                    day === TODAY ? 'border-primary bg-primary/5' : (weekday === 0 || weekday === 6) && 'bg-foreground/3',
                  )}
                />
              )
            })}
          </div>

          <div className="sticky top-0 z-40 flex h-12 border-b bg-background">
            <div ref={label} className="sticky left-0 z-50 flex w-64 shrink-0 max-md:w-36 items-center border-r bg-background px-3 text-xs font-medium text-faint">Task</div>
            <div className="relative shrink-0" style={{ width }}>
              {days.map((day, i) => {
                const date = toDate(day)
                const first = date.getDate() === 1 || i === 0
                return (
                  <div
                    key={day}
                    style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                    className={cn('absolute inset-y-0 grid place-content-center justify-items-center text-xs tabular-nums', first ? 'font-semibold text-muted-foreground' : 'text-faint')}
                  >
                    {date.toLocaleDateString('en-GB', first ? { month: 'short' } : { weekday: 'narrow' })}
                    <span
                      className={cn(
                        'grid size-6 place-content-center rounded-full text-sm',
                        day === TODAY ? 'bg-primary font-semibold text-primary-foreground' : 'font-medium text-foreground',
                      )}
                    >
                      {date.getDate()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {groups.map((group) => (
            <div key={group.key}>
              <div className="relative mt-1 flex h-8">
                <div className="sticky left-0 z-30 flex w-64 shrink-0 max-md:w-36 items-center gap-2 border-r bg-background px-3 text-xs font-semibold text-muted-foreground">
                  {group.id !== undefined && <ProjectDot id={group.id} />}
                  {group.name}
                  <span className="font-normal text-faint">{group.tasks.length}</span>
                </div>
              </div>
              {group.tasks.map((task) => (
                <Row key={task.id} task={task} days={days} drag={drag} bar={bar} showProject={group.id === undefined} showDay={showDay} />
              ))}
            </div>
          ))}
        </div>
      </div>
      )}
      <p className="mt-2 text-xs text-faint">
        Drag a bar to move it. Drag either end to make it longer or shorter. Click a day in an empty row to give that task a date.
      </p>
      <div className="-mx-2 mt-7">
        <AddRow />
      </div>
    </div>
  )
}
