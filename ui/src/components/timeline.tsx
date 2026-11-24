// Timeline: tasks across time, as the tools made for it draw them (Linear,
// Notion, Asana). Two panes in one scroller: on the left a column with a row
// per task (its check, its title, who is on it) under foldable project
// headers; on the right the days, with each task's bar on the same row as its
// title. Titles are never drawn on the chart, so a short bar cannot push its
// title under the next one, and the chart reads at any width. Zoom by week,
// month or quarter; the tasks with no date beside it (or, on a narrow screen,
// under it), to drag onto a day or open.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PanelRightCloseIcon, PanelRightOpenIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useTaskPeople } from '@/components/assignees'
import { Avatars } from '@/components/avatars'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { TaskCheck, useFinish } from '@/components/task-row'
import { FilterBar, FilterButton, NothingMatches, useViewFilter } from '@/components/view-filter'
import { useIsMobile } from '@/hooks/use-mobile'
import { projectStyle, useApp } from '@/lib/app-context'
import { addDays, daysBetween, fullDay, shortDay, toDate, TODAY, type Day } from '@/lib/days'
import { feel } from '@/lib/haptics'
import { play } from '@/lib/sounds'
import { dragBar, isSubtask, openTasks, patchTask, timelineGroups, type DragMode, type Task } from '@/lib/tasks'
import { DAY_PX, placed, spanOf, type Placed, type Zoom } from '@/lib/timeline-layout'
import { HOLD_MS, IDLE, press, released, type PressState } from '@/lib/timeline-press'
import { edgeOf, initialLeft, LEAD, leadFor, onScreen, paneLayout, spanFor } from '@/lib/timeline-window'
import { isFiltering, matchesFilter } from '@/lib/view-filter'
import { cn } from '@/lib/utils'

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

// A finger or a pen rather than a mouse: decides what the help says. What a
// press on a bar does is decided per press, by the pointer that made it, so
// an iPad with a trackpad drags at once like the Mac.
const COARSE = '(pointer: coarse)'
function subscribeCoarse(changed: () => void) {
  const query = window.matchMedia?.(COARSE)
  query?.addEventListener('change', changed)
  return () => query?.removeEventListener('change', changed)
}
const isCoarse = () => window.matchMedia?.(COARSE).matches ?? false
function useCoarse(): boolean {
  return useSyncExternalStore(subscribeCoarse, isCoarse, () => false)
}

// The width an element has, kept current: the Timeline lays itself out by
// the room it is given, which the window's width does not tell (a sidebar
// may be open beside it). Measured before the first paint.
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

interface Drag {
  id: number
  mode: DragMode
  x: number
  days: number
  length: number
  // Lifted by a hold of a finger: drawn raised even before it moves.
  held: boolean
}

// A dragged task from the No date list carries its id under this type.
const UNSCHEDULED = 'application/x-done-task'

// The bars are this far in from their days' edges, and never thinner than
// this, so a one-day task at quarter zoom (6 px a day) can still be seen.
const INSET = 2
const LEAST_BAR = 10
// Below this a bar has no grips: they would leave nothing to move it by.
const GRIPS_FROM = 22
// The chip in a row whose bar is off screen: its width, and its gap from the edge.
const EDGE_CHIP = 16
const EDGE_GAP = 4

export function Timeline() {
  const { data, dragging, edit, update, shown: inScope, me } = useApp()
  const isMobile = useIsMobile()
  const coarse = useCoarse()
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const rootWidth = useWidth(root)
  const layout = paneLayout(rootWidth)
  const leftWidth = layout.left
  const [zoom, setZoomState] = useState<Zoom>(storedZoom)
  const [panel, setPanelState] = useState(storedPanel)
  const [byProject, setByProjectState] = useState(storedGrouping)
  // The No date section under the chart, on narrow screens. Shut at first:
  // the chart is what this view is for, and its count says what is there.
  const [undatedOpen, setUndatedOpen] = useState(false)
  const setByProject = (next: boolean) => {
    setByProjectState(next)
    try {
      localStorage.setItem(GROUP_KEY, next ? 'yes' : 'no')
    } catch {
      // Private windows may refuse storage; the choice still applies for now.
    }
  }
  const [folded, setFolded] = useState<Set<string>>(() => new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropDay, setDropDay] = useState<Day | null>(null)
  const px = DAY_PX[zoom]

  const filter = useViewFilter()
  const visible = inScope.tasks.filter((t) => isSubtask(t) || matchesFilter(t, filter, TODAY, me))
  const groups = timelineGroups(inScope.projects, visible, 'project')
  const open = openTasks(visible)
  const dated = open.filter((t) => t.due || t.start)
  const undated = open.filter((t) => !t.due && !t.start)
  const shown = open.length
  const total = openTasks(inScope.tasks).length
  // A filter that matches nothing replaces the chart; when it is cleared
  // the chart comes back, scrolled to where it was (or to today).
  const chartShown = !(isFiltering(filter) && shown === 0)

  // The days drawn: a week before the earliest task to four weeks after the
  // latest, all at once, so the scrollbar shows the whole range.
  const datesKey = dated.map((t) => `${t.start}|${t.due}`).join(',')
  const span = useMemo(() => spanFor(dated, TODAY), [datesKey])
  const earliest = useMemo(() => dated.reduce<Day | null>((first, t) => {
    const day = (t.start ?? t.due)!
    return !first || day < first ? day : first
  }, null), [datesKey])
  const days = useMemo(() => Array.from({ length: span.days }, (_, i) => addDays(span.start, i)), [span.start, span.days])
  const width = span.days * px
  const x = (day: Day) => daysBetween(span.start, day) * px

  // The part of the chart on screen, in days: the scroller less the titles
  // column, which stays over the left of it.
  const view = () => {
    const el = scroller.current
    if (!el) return { left: 0, width: 0 }
    return { left: el.scrollLeft / px, width: Math.max(1, el.clientWidth - leftWidth) / px }
  }
  const [range, setRange] = useState<[Day, Day]>(() => onScreen(span, daysBetween(span.start, addDays(TODAY, -LEAD)), 30))
  // The same, unrounded, for the rows whose bar is off screen.
  const [seen, setSeen] = useState({ left: 0, width: Infinity })
  const look = () => {
    const now = view()
    setRange(onScreen(span, now.left, now.width))
    setSeen(now)
    return now
  }
  // The day at the left edge, kept when the range, the zoom or the width
  // changes; before the first scroll, where the view opens.
  const anchor = useRef<Day | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const { width: viewDays } = view()
    const left = anchor.current ? daysBetween(span.start, anchor.current) : initialLeft(span, TODAY, earliest, viewDays)
    el.scrollLeft = Math.max(0, left) * px
    look()
    // Laid out anew whenever the range, the zoom or the panes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span.start, span.days, px, rootWidth, chartShown])
  const onScroll = () => {
    const { left } = look()
    anchor.current = addDays(span.start, Math.round(left))
  }
  // Brings a day to the left of the chart with the same room before it as
  // when the view opens.
  const showDay = (day: Day) =>
    scroller.current?.scrollTo({ left: Math.max(0, daysBetween(span.start, day) - leadFor(view().width)) * px, behavior: 'smooth' })
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

  // Pressing a bar: whole days, its start or its end. A mouse takes it at
  // once; a finger has to hold it first (lib/timeline-press), or the press
  // is a scroll and is left to the browser.
  const pressing = useRef<{ state: PressState; timer: number; task: Task; mode: DragMode; el: HTMLElement; pointer: number }>(null)
  const daysMoved = (from: Drag, clientX: number) => {
    const moved = Math.round((clientX - from.x) / px)
    if (from.mode === 'end') return Math.max(moved, 1 - from.length)
    if (from.mode === 'start') return Math.min(moved, from.length - 1)
    return moved
  }
  const take = (task: Task, mode: DragMode, x: number, held: boolean) => {
    // A task with no due date has no bar to move; a tap still opens it.
    if (!task.due) return
    setDrag({ id: task.id, mode, x, days: 0, length: daysBetween(task.start ?? task.due, task.due) + 1, held })
    dragging.current = true
  }
  const stop = () => {
    if (pressing.current) clearTimeout(pressing.current.timer)
    pressing.current = null
    setDrag(null)
    dragging.current = false
  }
  // A held bar is being dragged, not the chart: the finger's moves must not
  // scroll. Only a listener that is not passive may say so, and on iOS only
  // one on touchmove; pointer events alone cannot.
  useEffect(() => {
    const hold = (event: TouchEvent) => {
      if (pressing.current?.state.kind === 'dragging') event.preventDefault()
    }
    window.addEventListener('touchmove', hold, { passive: false })
    return () => window.removeEventListener('touchmove', hold)
  }, [])
  useEffect(() => () => {
    if (pressing.current) clearTimeout(pressing.current.timer)
  }, [])
  const bar = {
    down(event: PointerEvent<HTMLDivElement>, task: Task) {
      if (event.button !== 0) return
      const grip = (event.target as HTMLElement).dataset.grip
      const mode: DragMode = grip === 'start' || grip === 'end' ? grip : 'move'
      const state = press(IDLE, { type: 'down', x: event.clientX, y: event.clientY, pointer: event.pointerType })
      const el = event.currentTarget
      const now = { state, timer: 0, task, mode, el, pointer: event.pointerId }
      pressing.current = now
      if (state.kind === 'dragging') {
        take(task, mode, event.clientX, false)
        el.setPointerCapture(event.pointerId)
        // No text selected under a mouse drag.
        event.preventDefault()
        return
      }
      now.timer = window.setTimeout(() => {
        if (pressing.current !== now) return
        now.state = press(now.state, { type: 'hold' })
        if (now.state.kind !== 'dragging') return
        take(task, mode, now.state.x, true)
        feel({ impact: 'light' })
        try {
          el.setPointerCapture(now.pointer)
        } catch {
          // The finger has already gone; its release ends the press.
        }
      }, HOLD_MS)
    },
    move(event: PointerEvent<HTMLDivElement>) {
      const now = pressing.current
      if (!now) return
      now.state = press(now.state, { type: 'move', x: event.clientX, y: event.clientY })
      if (now.state.kind === 'scrolling') clearTimeout(now.timer)
      if (drag && now.state.kind === 'dragging') setDrag({ ...drag, days: daysMoved(drag, event.clientX) })
    },
    up(event: PointerEvent<HTMLDivElement>, task: Task) {
      const now = pressing.current
      if (!now) return
      const moved = drag ? daysMoved(drag, event.clientX) : 0
      const mode = drag?.mode ?? 'move'
      const outcome = released(now.state, moved)
      stop()
      if (outcome === 'open') return edit(task.id)
      if (outcome !== 'move') return
      play('drop')
      update((d) => patchTask(d, task.id, dragBar(task, mode, moved)), task.id)
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
  const dropTarget = { onDragOver, onDrop, onDragLeave: () => setDropDay(null) }

  const toggleFold = (key: string) =>
    setFolded((now) => {
      const next = new Set(now)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // A row is a little taller under a finger, nearer the 44 points iOS asks for.
  const rowHeight = coarse ? 'h-10' : 'h-9'
  // The column of titles: it stays at the left while the days scroll under
  // it, and is opaque so they pass beneath it.
  const leftCell = 'sticky left-0 z-30 flex shrink-0 items-center border-r bg-background'

  // The day columns: weekends shaded where there is room to see them, the
  // first of each month marked, today in done's blue.
  const columns = (
    <div className="pointer-events-none absolute inset-y-0" style={{ left: leftWidth, width }}>
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
      {dropDay && <div className="absolute inset-y-0 bg-primary/10" style={{ left: x(dropDay), width: px }} />}
    </div>
  )

  // The date header: months above; days (or weeks, at quarter zoom) below.
  const months: { day: Day; left: number }[] = []
  days.forEach((day, i) => {
    if (i === 0 || toDate(day).getDate() === 1) months.push({ day, left: i * px })
  })
  const header = (
    <div className="sticky top-0 z-40 flex border-b bg-background">
      <div className={cn(leftCell, 'z-50 items-end px-3 pb-1.5 text-xs font-medium text-faint')} style={{ width: leftWidth }}>
        {byProject ? 'Projects' : 'Tasks'}
      </div>
      <div className="relative h-[60px] shrink-0" style={{ width }}>
        {months.map((m) => (
          <div key={m.day} className="absolute top-1 text-xs font-semibold whitespace-nowrap text-muted-foreground" style={{ left: m.left + 6 }}>
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
                {date.getDate()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )

  // A task's bar, as long as its days.
  const barFor = ({ task }: Placed) => {
    const moved = drag?.id === task.id ? drag : null
    const first = (task.start ?? task.due)!
    const length = task.due ? daysBetween(first, task.due) + 1 : 1
    let left = x(first) + INSET
    let barWidth = length * px - INSET * 2
    if (moved && moved.mode !== 'end') left += moved.days * px
    if (moved?.mode === 'end') barWidth += moved.days * px
    if (moved?.mode === 'start') barWidth -= moved.days * px
    // Wholly off the days on screen (an overdue task dated before them, or
    // one weeks ahead): a chip at that edge of the row says which way it is,
    // and brings it into view, so the row does not look empty.
    const edge = moved ? null : edgeOf(span, first, task.due ?? first, seen.left, seen.width)
    if (edge)
      return (
        <button
          type="button"
          aria-label={`Show ${task.title}, ${fullDay(first)}`}
          title={`${edge === 'before' ? 'Earlier' : 'Later'}: ${fullDay(first)}`}
          onClick={() => showDay(first)}
          style={{
            ...projectStyle(data.projects, task.projectId),
            left: edge === 'before' ? seen.left * px + EDGE_GAP : (seen.left + seen.width) * px - EDGE_GAP - EDGE_CHIP,
            width: EDGE_CHIP,
          }}
          // A finger's width of presses around the small chip.
          className="absolute top-1/2 z-10 grid h-5 -translate-y-1/2 place-content-center rounded-md border border-project-edge bg-project-tint text-project after:absolute after:-inset-2.5"
        >
          {edge === 'before' ? <ChevronLeftIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
        </button>
      )
    return (
      <TimelineBar
        task={task}
        left={left}
        width={Math.max(barWidth, LEAST_BAR)}
        range={length > 1}
        lifted={!!moved && (moved.held || moved.days !== 0)}
        onDown={(e) => bar.down(e, task)}
        onMove={bar.move}
        onUp={(e) => bar.up(e, task)}
        onCancel={bar.cancel}
      />
    )
  }

  // One task to a row, earliest first: its title on the left, its bar on the right.
  const taskRows = (items: Placed[]) =>
    [...items]
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.task.id - b.task.id)
      .map((p) => (
        <div key={p.task.id} className={cn('flex', rowHeight)}>
          <div className={cn(leftCell, 'px-2')} style={{ width: leftWidth }}>
            <TitleCell task={p.task} showProject={!byProject && !layout.narrow} faces={!layout.narrow} />
          </div>
          <div className="relative shrink-0" style={{ width }} {...dropTarget}>
            {barFor(p)}
          </div>
        </div>
      ))
  const placedAll = (tasks: Task[]) => tasks.map((t) => placed(t, 1)).filter((p): p is Placed => p !== null)

  const rows: ReactNode = !byProject
    ? // One timeline for everything, in date order; each title says its project.
      taskRows(placedAll(groups.flatMap((g) => g.tasks)))
    : groups.map((group) => {
        const key = String(group.id ?? 'inbox')
        const items = placedAll(group.tasks)
        // A project with nothing dated is only in No date.
        if (!items.length) return null
        const isFolded = folded.has(key)
        const whole = spanOf(items)
        return (
          <div key={key} className="border-b border-border/60">
            {/* The project: its name, how many of its tasks are on the chart, and the days they span. */}
            <div className={cn('flex', rowHeight)}>
              <button
                type="button"
                onClick={() => toggleFold(key)}
                aria-expanded={!isFolded}
                className={cn(leftCell, 'gap-1.5 px-2 text-left text-sm font-medium')}
                style={{ width: leftWidth }}
              >
                <ChevronRightIcon className={cn('size-3.5 shrink-0 text-faint transition-transform', !isFolded && 'rotate-90')} />
                {group.id !== undefined && <ProjectDot id={group.id} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 text-xs font-normal text-faint tabular-nums">{items.length}</span>
              </button>
              <div className="relative shrink-0" style={{ width }} {...dropTarget}>
                {whole && (
                  <div
                    aria-hidden
                    className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-project-edge"
                    style={{ ...projectStyle(data.projects, group.id ?? null), left: x(whole.from) + INSET, width: Math.max((daysBetween(whole.from, whole.to) + 1) * px - INSET * 2, LEAST_BAR) }}
                  />
                )}
              </div>
            </div>
            {!isFolded && taskRows(items)}
          </div>
        )
      })

  // The tasks with no date, by project: dragged onto a day with a mouse, or
  // opened (a tap on a phone) to give them one in the task's own sheet.
  const undatedList = (row: string) =>
    groups.map((group) => {
      const here = group.tasks.filter((t) => !t.due && !t.start)
      if (!here.length) return null
      return (
        <div key={String(group.id ?? 'inbox')} className="mt-2">
          <div className="flex items-center gap-1.5 px-2 pb-0.5 text-[11px] text-faint">
            {group.id !== undefined && <ProjectDot id={group.id} />}
            <span className="truncate">{group.name}</span>
          </div>
          {here.map((t) => (
            <UndatedRow key={t.id} task={t} className={row} onDragEnd={() => setDropDay(null)} coarse={coarse} />
          ))}
        </div>
      )
    })

  // Under the chart on a narrow screen: a section that opens and shuts, in
  // the column of titles, so the chart keeps the whole width.
  const undatedSection = !layout.side && undated.length > 0 && (
    <div className="border-t border-border">
      <div className="flex">
        <button
          type="button"
          aria-expanded={undatedOpen}
          onClick={() => setUndatedOpen(!undatedOpen)}
          className={cn(leftCell, rowHeight, 'gap-1.5 px-2 text-left text-sm font-medium')}
          style={{ width: leftWidth }}
        >
          <ChevronRightIcon className={cn('size-3.5 shrink-0 text-faint transition-transform', undatedOpen && 'rotate-90')} />
          <span className="min-w-0 flex-1 truncate">No date</span>
          <span className="shrink-0 text-xs font-normal text-faint tabular-nums">{undated.length}</span>
        </button>
        <div className="shrink-0" style={{ width }} />
      </div>
      {undatedOpen && (
        <div className="flex">
          <div className={cn(leftCell, 'block px-1 pb-2')} style={{ width: leftWidth }}>
            {undatedList(rowHeight)}
          </div>
          <div className="shrink-0" style={{ width }} />
        </div>
      )}
    </div>
  )

  const zoomChoices = (['week', 'month', 'quarter'] as Zoom[]).map((z) => ({ value: z, label: z[0].toUpperCase() + z.slice(1) }))
  const controls = layout.compact ? (
    <>
      {/* Little room: zoom and grouping in one menu. */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <SlidersHorizontalIcon />
            View
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1.5">
          <Choices label="Zoom" choices={zoomChoices} value={zoom} onChange={setZoom} big={coarse} />
          <div className="my-1.5 h-px bg-border" />
          <Choices
            label="Group by"
            choices={[
              { value: 'date', label: 'Date' },
              { value: 'project', label: 'Project' },
            ]}
            value={byProject ? 'project' : 'date'}
            onChange={(v) => setByProject(v === 'project')}
            big={coarse}
          />
        </PopoverContent>
      </Popover>
      <HeaderButton onClick={() => showDay(TODAY)}>Today</HeaderButton>
      <FilterButton />
    </>
  ) : (
    <>
      <div role="radiogroup" aria-label="Zoom" className="flex gap-0.5">
        {zoomChoices.map((z) => (
          <button
            key={z.value}
            type="button"
            role="radio"
            aria-checked={zoom === z.value}
            onClick={() => setZoom(z.value)}
            className={cn('h-8 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent', zoom === z.value && 'bg-primary/10 text-foreground')}
          >
            {z.label}
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
        className="text-muted-foreground"
        onClick={() => setPanel(!panel)}
        aria-pressed={panel}
        title={panel ? 'Hide tasks with no date' : 'Show tasks with no date'}
      >
        {panel ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
        {undated.length > 0 && <span className="tabular-nums">{undated.length}</span>}
      </Button>
    </>
  )

  const help = coarse
    ? `Hold a task and drag it to move it, or hold and drag its ends to change how long it takes. Tap a task to open it${byProject ? ', or a project’s name to fold its tasks away' : ''}.`
    : `Drag a task to move it, or its ends to change how long it takes. Click a task to open it${byProject ? ', or the project’s name to fold its tasks away' : ''}.`

  return (
    <div
      ref={root}
      // Nothing in the Timeline may widen the page: the chart scrolls
      // sideways inside its own box, and the page never does.
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip"
      style={
        isMobile
          ? {
              // A phone's page grows with what is in it and the window
              // scrolls, so nothing above bounds this view; it is given the
              // screen from below the navigation bar (the page's top padding)
              // to the tab bar, and the chart scrolls inside it with its date
              // header held at the top. The page's bottom padding is there to
              // clear the tab bar and New task for lists; past the tab bar it
              // is given back, or the window would still scroll by it. Not
              // flexed: the page around it would otherwise stretch it again.
              flex: 'none',
              height: 'calc(100svh - var(--safe-top) - 2.75rem - 3.0625rem - var(--safe-bottom))',
              marginBottom: 'calc(3.0625rem - 8rem)',
            }
          : undefined
      }
    >
      <ViewHeader title="Timeline" sub={`${shortDay(range[0])} to ${shortDay(range[1])}`}>
        {controls}
      </ViewHeader>
      <FilterBar shown={shown} total={total} />
      {/* On a phone the help goes above the chart: below it, New task would sit on it. */}
      {isMobile && <p className="mb-2 shrink-0 text-xs text-faint">{help}</p>}

      {!chartShown ? (
        <NothingMatches />
      ) : (
        // At least a few rows high, so a short landscape screen still shows a
        // chart (the page scrolls instead); otherwise it takes what is left.
        <div className="flex min-h-56 min-w-0 flex-1 border-y border-border">
          <div ref={scroller} onScroll={onScroll} className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
            <div className={cn('relative', isMobile && 'pb-20')} style={{ width: leftWidth + width }}>
              {header}
              <div className="relative">
                {columns}
                {rows}
              </div>
              {undatedSection}
            </div>
          </div>
          {layout.side && panel && (
            <aside aria-label="Tasks with no date" className="flex w-60 shrink-0 flex-col border-l border-border">
              <div className="flex items-baseline gap-2 px-4 pt-3 pb-1">
                <span className="text-xs font-medium text-faint">No date</span>
                <span className="text-xs text-faint tabular-nums">{undated.length || ''}</span>
              </div>
              <p className="px-4 pb-2 text-xs text-faint">{coarse ? 'Tap one to give it a date.' : 'Drag one onto a day to give it a date.'}</p>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                {undated.length === 0 && <p className="px-2 py-6 text-xs text-faint">Every task here has a date.</p>}
                {undatedList(coarse ? 'h-10' : 'py-1')}
              </div>
            </aside>
          )}
        </div>
      )}
      {/* Hidden on a screen too short to spare the line (a phone on its side). */}
      {!isMobile && <p className="mt-2 shrink-0 text-xs text-faint [@media(max-height:500px)]:hidden">{help}</p>}
      {/* A phone adds with its New task button. */}
      {!isMobile && (
        <div className="-mx-2 mt-2 shrink-0">
          <AddRow />
        </div>
      )}
    </div>
  )
}

// A row of the titles column: the check, the title (a tap opens the task)
// and who is on it, small.
// On a phone in portrait (`faces` false) the title needs every bit of the
// row, so who is on the task is left to the task's sheet.
function TitleCell({ task, showProject, faces }: { task: Task; showProject: boolean; faces: boolean }) {
  const { edit } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const { on } = useTaskPeople(task)
  return (
    <div data-task={task.id} className={cn('flex min-w-0 flex-1 items-center gap-2', leaving && 'opacity-0 transition-opacity duration-150')}>
      <TaskCheck task={task} checked={leaving} onChange={finish} className="shrink-0" />
      {/* On one timeline for everything, which project it is in. */}
      {showProject && <ProjectDot id={task.projectId} className="shrink-0" />}
      <button type="button" onClick={() => edit(task.id)} title={task.title} className="min-w-0 flex-1 truncate text-left text-[13px]">
        {task.title}
      </button>
      {faces && <Avatars people={on} size="xs" max={2} className="shrink-0" />}
    </div>
  )
}

// A task's bar on the chart. No title in it (that is in the column of
// titles, on the same row), so it may be as short as its days.
function TimelineBar({
  task,
  left,
  width,
  range,
  lifted,
  onDown,
  onMove,
  onUp,
  onCancel,
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
}) {
  const { data, noticed } = useApp()
  const pointer = useRef('mouse')
  const grips = width >= GRIPS_FROM
  return (
    <div
      data-task={task.id}
      title={`${task.title}${task.due ? `, ${task.start ? `${fullDay(task.start)} to ` : ''}${fullDay(task.due)}` : ''}`}
      style={{ ...projectStyle(data.projects, task.projectId), left, width }}
      className={cn(
        // A pan that starts on a bar still scrolls the chart (touch-action);
        // a held bar stops it from script. No callout or selection on a hold.
        'absolute top-1/2 z-10 h-5 -translate-y-1/2 cursor-grab rounded-md border border-project-edge bg-project-tint select-none [-webkit-touch-callout:none] [touch-action:pan-x_pan-y]',
        lifted && 'z-20 cursor-grabbing shadow-md ring-2 ring-primary/40',
        noticed === task.id && 'animate-noticed',
      )}
      onPointerDown={(e) => {
        pointer.current = e.pointerType
        onDown(e)
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      // A long press of a finger is the hold that lifts the bar; it must not
      // also open the window's task menu. A right click still does.
      onContextMenu={(e) => {
        if (pointer.current === 'mouse') return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {/* The grips: drawn thin at the bar's ends, but each takes a finger's
          width of presses, mostly outside the bar, where its row is empty
          (one task to a row), so a short bar can still be moved by its middle. */}
      {grips && range && (
        <span data-grip="start" className="group/grip absolute -inset-y-2 -left-5 z-10 w-[26px] cursor-ew-resize">
          <span className="pointer-events-none absolute inset-y-2 right-0 w-1.5 rounded-l-md group-hover/grip:bg-project-edge" />
        </span>
      )}
      {/* Stretched from its end into more days, whatever its length now. */}
      {grips && (
        <span data-grip="end" className="group/grip absolute -inset-y-2 -right-5 z-10 w-[26px] cursor-ew-resize">
          <span className="pointer-events-none absolute inset-y-2 left-0 w-1.5 rounded-r-md group-hover/grip:bg-project-edge" />
        </span>
      )}
    </div>
  )
}

// A task with no date: its round check, as in every list, and its title,
// which opens it. A mouse can drag it onto a day.
function UndatedRow({ task, className, onDragEnd, coarse }: { task: Task; className: string; onDragEnd: () => void; coarse: boolean }) {
  const { edit } = useApp()
  const [leaving, finish] = useFinish(task.id)
  return (
    <div
      data-task={task.id}
      draggable={!coarse}
      onDragStart={(e) => {
        e.dataTransfer.setData(UNSCHEDULED, String(task.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={onDragEnd}
      title={coarse ? task.title : `${task.title}. Drag onto a day to give it a date`}
      className={cn('flex items-center gap-2 rounded-md px-2 text-[13px] hover:bg-muted', !coarse && 'cursor-grab active:cursor-grabbing', className)}
    >
      <TaskCheck task={task} checked={leaving} onChange={finish} className="shrink-0" />
      <button type="button" onClick={() => edit(task.id)} className="min-w-0 flex-1 truncate text-left">
        {task.title}
      </button>
    </div>
  )
}

// One choice of several, as a list of rows with a check by the chosen one.
function Choices<T extends string>({
  label,
  choices,
  value,
  onChange,
  big,
}: {
  label: string
  choices: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  big: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col">
      <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-faint">{label}</div>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          onClick={() => onChange(c.value)}
          className={cn('flex items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent', big ? 'h-11' : 'h-8')}
        >
          <span className="flex-1">{c.label}</span>
          {value === c.value && <CheckIcon className="size-4 text-primary" />}
        </button>
      ))}
    </div>
  )
}
