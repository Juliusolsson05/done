// Timeline: the coming weeks as a grid of days, one row per task. shadcn has
// no such component, so the grid is plain elements; its controls are not.
import { useRef, useState, type PointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { PriorityDot, ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { TaskCheck, useFinish } from '@/components/task-row'
import { projectStyle, useApp } from '@/lib/app-context'
import { addDays, daysBetween, fullDay, shortDay, toDate, TODAY, type Day } from '@/lib/days'
import { dragBar, patchTask, timelineGroups, type DragMode, type Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// The width of one day in pixels. Every left and width below is a number of
// days times this, which is why they are style props and not classes.
const DAY_WIDTH = 38
const DAYS = 35

// Measures a title, to know whether it fits inside its bar.
let ruler: CanvasRenderingContext2D | null = null
function textWidth(text: string): number {
  ruler ??= document.createElement('canvas').getContext('2d')
  if (!ruler) return 0
  ruler.font = '500 12px -apple-system, system-ui, sans-serif'
  return ruler.measureText(text).width
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

function Row({ task, days, drag, bar }: { task: Task; days: Day[]; drag: Drag | null; bar: BarHandlers }) {
  const { data, ui, noticed, edit, update } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const first = task.start ?? task.due
  const moved = drag?.id === task.id ? drag : null

  let track
  if (task.due && first) {
    let left = daysBetween(ui.tlStart, first) * DAY_WIDTH + 2
    let width = (daysBetween(first, task.due) + 1) * DAY_WIDTH - 4
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
          moved && moved.days !== 0 && 'z-20 cursor-grabbing shadow-md',
          noticed === task.id && 'animate-noticed',
        )}
        onPointerDown={(e) => bar.down(e, task)}
        onPointerMove={bar.move}
        onPointerUp={(e) => bar.up(e, task)}
        onPointerCancel={bar.cancel}
      >
        <span data-grip="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" />
        <PriorityDot priority={task.priority} />
        {/* A bar too short for its title shows the title beside it, in full. */}
        <span className={cn('pointer-events-none', !fits && 'absolute top-1/2 left-full ml-2 -translate-y-1/2 font-normal')}>{task.title}</span>
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
        onClick={() => update((d) => patchTask(d, task.id, { start: null, due: day }), task.id)}
      />
    ))
  }

  return (
    <div data-task={task.id} className={cn('relative flex h-9', leaving && 'opacity-0 transition-opacity delay-150 duration-150')}>
      <div className="sticky left-0 z-30 flex w-64 shrink-0 items-center gap-2.5 border-r bg-background px-3">
        <TaskCheck task={task} checked={leaving} onChange={finish} />
        <Button
          variant="ghost"
          onClick={() => edit(task.id)}
          className={cn('h-auto min-w-0 flex-1 justify-start rounded-none p-0 font-normal hover:bg-transparent', leaving && 'text-faint line-through')}
        >
          <span className="truncate">{task.title}</span>
        </Button>
      </div>
      <div className="relative shrink-0 overflow-hidden" style={{ width: DAYS * DAY_WIDTH }}>
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
  const { data, ui, dragging, setTlStart, edit, update } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const days = Array.from({ length: DAYS }, (_, i) => addDays(ui.tlStart, i))
  const width = DAYS * DAY_WIDTH
  const groups = timelineGroups(data.projects, data.tasks)

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
      update((d) => patchTask(d, task.id, dragBar(task, drag.mode, moved)), task.id)
    },
    cancel: stop,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title="Timeline" sub={`${shortDay(ui.tlStart)} to ${shortDay(addDays(ui.tlStart, DAYS - 1))}`}>
        <HeaderButton onClick={() => setTlStart(addDays(ui.tlStart, -7))}>Earlier</HeaderButton>
        <HeaderButton
          onClick={() => {
            setTlStart(addDays(TODAY, -4))
            scroller.current?.scrollTo({ left: 0 })
          }}
        >
          Today
        </HeaderButton>
        <HeaderButton onClick={() => setTlStart(addDays(ui.tlStart, 7))}>Later</HeaderButton>
      </ViewHeader>

      <div ref={scroller} className="min-h-0 overflow-auto rounded-xl border">
        <div className="relative w-max min-w-full">
          {/* The day columns behind every row: weekends shaded, today marked. */}
          <div className="pointer-events-none absolute inset-y-0 left-64" style={{ width }}>
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
            <div className="sticky left-0 z-50 flex w-64 shrink-0 items-center border-r bg-background px-3 text-xs font-medium text-faint">Task</div>
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
            <div key={group.id ?? 'inbox'}>
              <div className="relative mt-1 flex h-8">
                <div className="sticky left-0 z-30 flex w-64 shrink-0 items-center gap-2 border-r bg-background px-3 text-xs font-semibold text-muted-foreground">
                  <ProjectDot id={group.id} />
                  {group.name}
                  <span className="font-normal text-faint">{group.tasks.length}</span>
                </div>
              </div>
              {group.tasks.map((task) => (
                <Row key={task.id} task={task} days={days} drag={drag} bar={bar} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">
        Drag a bar to move it. Drag either end to make it longer or shorter. Click a day in an empty row to give that task a date.
      </p>
      <div className="-mx-2 mt-7">
        <AddRow />
      </div>
    </div>
  )
}
