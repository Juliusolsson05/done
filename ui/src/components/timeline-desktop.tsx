// The Timeline on the Mac and in a desktop browser, exactly as approved on
// 23 Nov (5161a05). The touch rebuild in timeline.tsx serves the iPhone and
// iPad; it replaced this one at every size on 24 Nov and the owner rejected
// that on the Mac. See docs/plans/2026-11-25-timeline-desktop-back.md.
// Timeline: projects across time, as the tools made for it draw them (Linear,
// Notion, Asana). One row per project with a bar for the time it spans; its
// tasks packed underneath in as few lines as fit, one-day tasks as pills and
// longer ones as bars; zoom by week, month or quarter; and the tasks with no
// date in a panel beside it, to drag onto a day.
import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { ChevronRightIcon, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react'
import { TaskFaces } from '@/components/assignees'
import { Button } from '@/components/ui/button'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { ProjectTimelineRows } from '@/components/timeline-project-rows'
import { TaskCheck, useFinish } from '@/components/task-row'
import { FilterBar, FilterButton, NothingMatches, useTaskFilter } from '@/components/view-filter'
import { projectStyle, useApp } from '@/lib/app-context'
import { addDays, daysBetween, fullDay, shortDay, toDate, TODAY, type Day } from '@/lib/days'
import { play } from '@/lib/sounds'
import { dragBar, openTasks, patchTask, timelineGroups, type DragMode, type Task } from '@/lib/tasks'
import { DAY_PX, placed, type Placed, type Zoom } from '@/lib/timeline-layout'
import { projectTimelines, timelineProjectDates } from '@/lib/timeline-projects'
import { LEAD, onScreen, spanFor } from '@/lib/timeline-window'
import { cn } from '@/lib/utils'

// Measures a title, to know how wide its pill is: in a hidden element set
// exactly as the pill's title is, so the font is the one drawn. Remembered.
let ruler: HTMLSpanElement | null = null
const measured = new Map<string, number>()
function textWidth(text: string): number {
  const known = measured.get(text)
  if (known !== undefined) return known
  if (!ruler) {
    ruler = document.createElement('span')
    ruler.className = 'text-xs font-medium whitespace-pre'
    ruler.setAttribute('aria-hidden', 'true')
    ruler.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0'
    document.body.appendChild(ruler)
  }
  ruler.textContent = text
  const width = Math.ceil(ruler.getBoundingClientRect().width) + 1
  measured.set(text, width)
  return width
}
// A pill: check, title (cut past this width), and room either side.
// A pill: as wide as its title up to MAX_LABEL, where the title is cut (the
// whole of it shows on hover); one line, so every line of the chart is the same height.
const MAX_LABEL = 220
const extra = (task: Task) => 46 + (task.assignees?.length ? 16 + Math.min(task.assignees.length, 3) * 16 : 0)
const pillWidth = (task: Task) => Math.min(textWidth(task.title), MAX_LABEL) + extra(task)

// The zoom is a habit of the person, so it is remembered on this device.
const ZOOM_KEY = 'done-timeline-zoom'
function storedZoom(): Zoom {
  try {
    const z = localStorage.getItem(ZOOM_KEY)
    return z === 'month' || z === 'quarter' ? z : 'week'
  } catch {
    return 'week'
  }
}
// Grouped into a row per project, or all tasks on one timeline (the default).
const GROUP_KEY = 'done-timeline-by-project'
function storedGrouping(): boolean {
  try {
    return localStorage.getItem(GROUP_KEY) === 'yes'
  } catch {
    return false
  }
}
const PANEL_KEY = 'done-timeline-unscheduled'
function storedPanel(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== 'closed'
  } catch {
    return true
  }
}

interface Drag {
  id: number
  mode: DragMode
  x: number
  days: number
  length: number
}

// A dragged task from the Unscheduled panel carries its id under this type.
const UNSCHEDULED = 'application/x-done-task'

export function TimelineDesktop() {
  const { dragging, edit, update, shown: inScope } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLDivElement>(null)
  const [zoom, setZoomState] = useState<Zoom>(storedZoom)
  const [panel, setPanelState] = useState(storedPanel)
  const [byProject, setByProjectState] = useState(storedGrouping)
  const setByProject = (next: boolean) => {
    setByProjectState(next)
    try {
      localStorage.setItem(GROUP_KEY, next ? 'yes' : 'no')
    } catch {
      // Private windows may refuse storage; the choice still applies for now.
    }
  }
  // The column of project names, only when grouped by project.
  const side = byProject ? 'w-52 max-md:w-32' : 'w-0 overflow-hidden border-r-0 p-0'
  const [folded, setFolded] = useState<Set<string>>(() => new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropDay, setDropDay] = useState<Day | null>(null)
  const px = DAY_PX[zoom]

  const filter = useTaskFilter()
  const visible = filter.apply(inScope.tasks)
  const groups = timelineGroups(inScope.projects, visible, 'project')
  const projectRows = projectTimelines(inScope.projects, visible, filter.filter)
  const open = openTasks(visible)
  const dated = open.filter((t) => t.due || t.start)
  const undated = open.filter((t) => !t.due && !t.start)
  const shown = open.length
  const total = openTasks(inScope.tasks).length

  // The days drawn: a week before the earliest task to four weeks after the
  // latest, all at once, so the scrollbar shows the whole range.
  const span = spanFor([...dated, ...timelineProjectDates(projectRows, TODAY)], TODAY)
  const days = useMemo(() => Array.from({ length: span.days }, (_, i) => addDays(span.start, i)), [span.start, span.days])
  const width = span.days * px
  const x = (day: Day) => daysBetween(span.start, day) * px

  const view = () => {
    const el = scroller.current
    if (!el) return { left: 0, width: 0 }
    return { left: el.scrollLeft / px, width: (el.clientWidth - (label.current?.offsetWidth ?? 0)) / px }
  }
  const [range, setRange] = useState<[Day, Day]>(() => onScreen(span, daysBetween(span.start, addDays(TODAY, -LEAD)), 30))
  // Keeps the same day at the left edge when the range or the zoom changes.
  const anchor = useRef<Day | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollLeft = Math.max(0, daysBetween(span.start, anchor.current ?? addDays(TODAY, -LEAD))) * px
    const { left, width } = view()
    setRange(onScreen(span, left, width))
    // Laid out anew whenever the range or the zoom changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span.start, span.days, px])
  const onScroll = () => {
    const { left, width } = view()
    anchor.current = addDays(span.start, Math.round(left))
    setRange(onScreen(span, left, width))
  }
  const showDay = (day: Day) => scroller.current?.scrollTo({ left: Math.max(0, daysBetween(span.start, day) - LEAD) * px, behavior: 'smooth' })
  const setZoom = (next: Zoom) => {
    anchor.current = addDays(span.start, Math.round(view().left))
    setZoomState(next)
    try {
      localStorage.setItem(ZOOM_KEY, next)
    } catch {
      // Private windows may refuse storage; the zoom still applies for now.
    }
  }
  const setPanel = (next: boolean) => {
    setPanelState(next)
    try {
      localStorage.setItem(PANEL_KEY, next ? 'open' : 'closed')
    } catch {
      // As above.
    }
  }

  // Dragging a pill or a bar: whole days, its start or its end.
  const daysMoved = (from: Drag, clientX: number) => {
    const moved = Math.round((clientX - from.x) / px)
    if (from.mode === 'end') return Math.max(moved, 1 - from.length)
    if (from.mode === 'start') return Math.min(moved, from.length - 1)
    return moved
  }
  const stop = () => {
    setDrag(null)
    dragging.current = false
  }
  const bar = {
    down(event: PointerEvent<HTMLDivElement>, task: Task) {
      if (event.button !== 0 || !task.due) return
      if ((event.target as HTMLElement).closest('[data-check]')) return
      const grip = (event.target as HTMLElement).dataset.grip
      const mode: DragMode = grip === 'start' || grip === 'end' ? grip : 'move'
      setDrag({ id: task.id, mode, x: event.clientX, days: 0, length: daysBetween(task.start ?? task.due, task.due) + 1 })
      dragging.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    move(event: PointerEvent<HTMLDivElement>) {
      if (drag) setDrag({ ...drag, days: daysMoved(drag, event.clientX) })
    },
    up(event: PointerEvent<HTMLDivElement>, task: Task) {
      if (!drag) return
      const moved = daysMoved(drag, event.clientX)
      stop()
      if (moved === 0) return edit(task.id)
      play('drop')
      update((d) => patchTask(d, task.id, dragBar(task, drag.mode, moved)), task.id)
    },
    cancel: stop,
  }

  // Dropping an undated task on a day gives it that day.
  const dayAt = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.floor((event.clientX - rect.left) / px)
    return index >= 0 && index < span.days ? addDays(span.start, index) : null
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(UNSCHEDULED)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropDay(dayAt(event))
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const id = Number(event.dataTransfer.getData(UNSCHEDULED))
    const day = dayAt(event)
    setDropDay(null)
    if (!id || !day) return
    event.preventDefault()
    play('drop')
    update((d) => patchTask(d, id, { start: null, due: day }), id)
  }

  const toggleFold = (key: string) =>
    setFolded((now) => {
      const next = new Set(now)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // The day columns: weekends shaded where there is room to see them, the
  // first of each month marked, today in done's blue.
  const columns = (
    <div className="pointer-events-none absolute inset-y-0" style={{ left: 0, width }}>
      {days.map((day, i) => {
        const date = toDate(day)
        const weekend = date.getDay() === 0 || date.getDay() === 6
        const monthStart = date.getDate() === 1
        if (zoom === 'quarter' && !monthStart && day !== TODAY) return null
        return (
          <div
            key={day}
            style={{ left: i * px, width: px }}
            className={cn(
              'absolute inset-y-0',
              zoom !== 'quarter' && 'border-l border-border/50',
              monthStart && 'border-l border-border',
              zoom !== 'quarter' && weekend && 'bg-foreground/[0.025]',
            )}
          />
        )
      })}
      <div className="absolute inset-y-0 w-px bg-primary" style={{ left: x(TODAY) + px / 2 }} />
    </div>
  )

  // The date header: months above; days (or weeks, at quarter zoom) below.
  const months: { day: Day; left: number }[] = []
  days.forEach((day, i) => {
    if (i === 0 || toDate(day).getDate() === 1) months.push({ day, left: i * px })
  })
  const header = (
    <div className="sticky top-0 z-40 flex border-b bg-background">
      <div ref={label} className={cn('sticky left-0 z-50 flex shrink-0 items-end border-r bg-background px-3 pb-1.5 text-xs font-medium text-faint', side)}>
        {byProject && 'Projects'}
      </div>
      <div className="relative h-[60px] shrink-0" style={{ width }}>
        {months.map((m) => (
          <div key={m.day} className="absolute top-1 text-xs font-semibold text-muted-foreground" style={{ left: m.left + 6 }}>
            {toDate(m.day).toLocaleDateString('en-GB', { month: 'long', ...(toDate(m.day).getMonth() === 0 || m.left === 0 ? { year: 'numeric' } : {}) })}
          </div>
        ))}
        {days.map((day, i) => {
          const date = toDate(day)
          if (zoom === 'quarter' && date.getDay() !== 1 && day !== TODAY) return null
          if (zoom === 'month' && date.getDay() !== 1 && day !== TODAY) return null
          // A week's label right beside today's would run into it.
          if (zoom !== 'week' && day !== TODAY && Math.abs(daysBetween(day, TODAY)) * px < 28) return null
          return (
            <div
              key={day}
              className={cn('absolute bottom-1 flex flex-col items-center gap-0.5 text-[11px] tabular-nums', zoom !== 'week' && day !== TODAY && '-translate-x-1/4')}
              style={{ left: i * px, width: zoom === 'week' ? px : undefined }}
            >
              {/* The day of the week: a letter where every day shows, short where only some do. */}
              <span className={cn('text-[10px] leading-none text-faint', (date.getDay() === 0 || date.getDay() === 6) && 'opacity-70')}>
                {date.toLocaleDateString('en-GB', { weekday: zoom === 'week' ? 'narrow' : 'short' })}
              </span>
              <span
                className={cn(
                  'grid h-5 min-w-5 place-content-center rounded-full px-1',
                  day === TODAY ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {zoom === 'week' ? date.getDate() : `${date.getDate()}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )

  // A task on the chart: a pill for a day, a bar for longer.
  const item = ({ task, from }: Placed) => {
    const moved = drag?.id === task.id ? drag : null
    const first = task.start ?? task.due ?? from
    const length = task.due ? daysBetween(first, task.due) + 1 : 1
    let left = x(first) + 2
    let barWidth = length * px - 4
    if (moved && moved.mode !== 'end') left += moved.days * px
    if (moved?.mode === 'end') barWidth += moved.days * px
    if (moved?.mode === 'start') barWidth -= moved.days * px
    return (
      <TimelineItem
        key={task.id}
        task={task}
        left={left}
        width={barWidth}
        range={length > 1}
        lifted={!!moved && moved.days !== 0}
        onDown={(e) => bar.down(e, task)}
        onMove={bar.move}
        onUp={(e) => bar.up(e, task)}
        onCancel={bar.cancel}
        showProject={!byProject}
      />
    )
  }

  // One task to a row, earliest first.
  const oneEach = (items: Placed[]) => [...items].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.task.id - b.task.id).map((p) => [p])
  // The rows of tasks.
  const laneRows = (lanes: Placed[][]) =>
    lanes.map((lane, i) => (
      <div key={i} className="relative flex h-8">
        <div className={cn('sticky left-0 z-30 shrink-0 border-r bg-background', side)} />
        <div className="relative shrink-0" style={{ width }} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDropDay(null)}>
          {lane.map(item)}
        </div>
      </div>
    ))
  const placedAll = (tasks: Task[]) => tasks.map((t) => placed(t, Math.ceil(pillWidth(t) / px))).filter((p): p is Placed => p !== null)

  const rows = !byProject
    ? // One timeline for everything, packed by date; each task says its project.
      [<div key="all" className="pt-1 pb-2">{laneRows(oneEach(placedAll(groups.flatMap((g) => g.tasks))))}</div>]
    : groups.map((group) => {
    const key = String(group.id ?? 'inbox')
    const items = placedAll(group.tasks)
    const lanes = oneEach(items)
    const isFolded = folded.has(key)
    return (
      <div key={key} className="border-b border-border/60">
        {/* The project: its name, and how many of its tasks are on the chart. */}
        <div className="relative flex h-9">
          <button
            type="button"
            onClick={() => toggleFold(key)}
            aria-expanded={!isFolded}
            className="sticky left-0 z-30 flex w-52 shrink-0 items-center gap-1.5 border-r bg-background px-2 text-left text-sm font-medium max-md:w-32"
          >
            <ChevronRightIcon className={cn('size-3.5 shrink-0 text-faint transition-transform', !isFolded && 'rotate-90')} />
            {group.id !== undefined && <ProjectDot id={group.id} className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
            <span className="shrink-0 text-xs font-normal text-faint tabular-nums">{items.length}</span>
          </button>
          <div className="relative shrink-0" style={{ width }} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDropDay(null)}>
          </div>
        </div>
        {/* Its tasks, in as few lines as fit them. */}
        {!isFolded && laneRows(lanes)}
      </div>
    )
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title="Timeline" sub={`${shortDay(range[0])} to ${shortDay(range[1])}`}>
        <div role="radiogroup" aria-label="Zoom" className="flex gap-0.5">
          {(['week', 'month', 'quarter'] as Zoom[]).map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={zoom === z}
              onClick={() => setZoom(z)}
              className={cn('h-8 rounded-md px-2.5 text-sm capitalize text-muted-foreground hover:bg-accent', zoom === z && 'bg-primary/10 text-foreground')}
            >
              {z}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={byProject}
          onClick={() => setByProject(!byProject)}
          className={cn('text-muted-foreground', byProject && 'bg-primary/10 text-foreground hover:bg-primary/15')}
        >
          Group by project
        </Button>
        <HeaderButton onClick={() => showDay(TODAY)}>Today</HeaderButton>
        <FilterButton />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground max-md:hidden"
          onClick={() => setPanel(!panel)}
          aria-pressed={panel}
          title={panel ? 'Hide tasks with no date' : 'Show tasks with no date'}
        >
          {panel ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          {undated.length > 0 && <span className="tabular-nums">{undated.length}</span>}
        </Button>
      </ViewHeader>
      <FilterBar shown={shown} total={total} />

      {filter.on && shown === 0 && projectRows.length === 0 ? (
        <NothingMatches />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div ref={scroller} onScroll={onScroll} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-x-contain border-t border-border">
            <div className="relative w-max min-w-full">
              {header}
              <div className="relative">
                <div className={cn('absolute inset-y-0', byProject ? 'left-52 max-md:left-32' : 'left-0')}>
                  {columns}
                  {dropDay && <div className="absolute inset-y-0 bg-primary/10" style={{ left: x(dropDay), width: px }} />}
                </div>
                <ProjectTimelineRows
                  rows={projectRows}
                  start={span.start}
                  dayWidth={px}
                  width={width}
                  leading={byProject ? <div className={cn('sticky left-0 z-30 shrink-0 border-r bg-background', side)} /> : undefined}
                />
                {rows}
              </div>
            </div>
          </div>
          {panel && (
            <aside aria-label="Tasks with no date" className="flex w-60 shrink-0 flex-col border-t border-l border-border max-md:hidden">
              <div className="flex items-baseline gap-2 px-4 pt-3 pb-1">
                <span className="text-xs font-medium text-faint">No date</span>
                <span className="text-xs text-faint tabular-nums">{undated.length || ''}</span>
              </div>
              <p className="px-4 pb-2 text-xs text-faint">Drag one onto a day to give it a date.</p>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                {undated.length === 0 && <p className="px-2 py-6 text-xs text-faint">Every task here has a date.</p>}
                {groups.map((group) => {
                  const here = group.tasks.filter((t) => !t.due && !t.start)
                  if (!here.length) return null
                  return (
                    <div key={String(group.id ?? 'inbox')} className="mt-2">
                      <div className="flex items-center gap-1.5 px-2 pb-0.5 text-[11px] text-faint">
                        {group.id !== undefined && <ProjectDot id={group.id} />}
                        {group.name}
                      </div>
                      {here.map((t) => (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(UNSCHEDULED, String(t.id))
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragEnd={() => setDropDay(null)}
                          title={`${t.title}. Drag onto a day to give it a date`}
                          className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted active:cursor-grabbing"
                        >
                          <UndatedCheck task={t} />
                          <button type="button" onClick={() => edit(t.id)} className="min-w-0 flex-1 truncate text-left">
                            {t.title}
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </aside>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-faint">Drag a task to move it, or its ends to change how long it takes. Click the project's name to fold its tasks away.</p>
      <div className="-mx-2 mt-5">
        <AddRow />
      </div>
    </div>
  )
}

function TimelineItem({
  task,
  left,
  width,
  range,
  lifted,
  onDown,
  onMove,
  onUp,
  onCancel,
  showProject,
}: {
  task: Task
  left: number
  width: number
  range: boolean
  lifted: boolean
  onDown: (e: PointerEvent<HTMLDivElement>) => void
  onMove: (e: PointerEvent<HTMLDivElement>) => void
  onUp: (e: PointerEvent<HTMLDivElement>) => void
  onCancel: () => void
  showProject: boolean
}) {
  const { data, noticed } = useApp()
  const [leaving, finish] = useFinish(task.id)
  // The block is as long as the task's days, never narrower than its check.
  const block = Math.max(width, 22)
  // The title goes inside when it fits there, whole; otherwise just after
  // the block, as plain text.
  const facesWidth = task.assignees?.length ? 10 + Math.min(task.assignees.length, 3) * 14 : 0
  const inside = textWidth(task.title) + (showProject ? 14 : 0) + facesWidth + 30 <= block
  const label = (
    <>
      {/* On one timeline for everything, which project it is in. */}
      {showProject && <ProjectDot id={task.projectId} className="shrink-0" />}
      <span className={cn('min-w-0 truncate', inside ? 'flex-1' : 'max-w-[420px]')}>{task.title}</span>
      <span className="shrink-0">
        <TaskFaces task={task} ring={inside ? 'ring-project-tint' : 'ring-background'} />
      </span>
    </>
  )
  return (
    <div
      data-task={task.id}
      title={`${task.title}${task.due ? `, ${task.start ? `${fullDay(task.start)} to ` : ''}${fullDay(task.due)}` : ''}`}
      style={{ ...projectStyle(data.projects, task.projectId), left, width: block }}
      className={cn(
        'absolute top-1 z-10 flex h-6 cursor-grab touch-none items-center gap-1.5 rounded-md bg-project-tint pr-2.5 pl-1.5 text-xs font-medium whitespace-nowrap select-none',
        lifted && 'z-20 cursor-grabbing shadow-md',
        leaving && 'opacity-0 transition-opacity duration-150',
        noticed === task.id && 'animate-noticed',
      )}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      {range && <span data-grip="start" className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize rounded-l-md hover:bg-project-edge" />}
      <span data-check className="flex">
        <TaskCheck task={task} checked={leaving} onChange={finish} className="size-3.5" />
      </span>
      {inside ? (
        <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5">{label}</span>
      ) : (
        // Beside the block, and part of it: dragging the title moves the
        // task, and a click on it opens it, as on the block itself.
        <span className="absolute top-1/2 left-full ml-2 flex -translate-y-1/2 items-center gap-1.5 text-foreground hover:underline">{label}</span>
      )}
      {/* Stretched from its end into more days, whatever its length now. */}
      <span data-grip="end" className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-md hover:bg-project-edge" />
    </div>
  )
}

// The round check of a task with no date, as in every list: it finishes it.
function UndatedCheck({ task }: { task: Task }) {
  const [leaving, finish] = useFinish(task.id)
  return <TaskCheck task={task} checked={leaving} onChange={finish} className="size-3.5 shrink-0" />
}
