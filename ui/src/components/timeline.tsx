// Timeline on a touch screen (iPhone, iPad): tasks across time. The days take
// the whole width of one scroller; each task has a row, its name on a line
// above its bar (check, name, who is on it), pinned to the visible edge when
// the bar runs off it, so a row always says what it is and no column of names
// takes the width (docs/plans/2026-11-27-phone-timeline.md). Rows can be
// grouped under foldable projects. Zoom by day, week, month or quarter, a day
// fitted to the room (lib/timeline-touch); the tasks with no date beside the
// chart (or, on a narrow screen, under it), to drag onto a day or open.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react'
import { useTaskPeople } from '@/components/assignees'
import { Avatars } from '@/components/avatars'
import { Button } from '@/components/ui/button'
import { ViewHeader } from '@/components/list-view'
import { ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { TaskCheck, useFinish } from '@/components/task-row'
import { ProjectTimelineRows } from '@/components/timeline-project-rows'
import { FilterBar, FilterButton, NothingMatches, useTaskFilter } from '@/components/view-filter'
import { useIsMobile } from '@/hooks/use-mobile'
import { projectStyle, useApp } from '@/lib/app-context'
import { addDays, daysBetween, fullDay, shortDay, toDate, TODAY, type Day } from '@/lib/days'
import { feel } from '@/lib/haptics'
import { play } from '@/lib/sounds'
import { dragBar, openTasks, patchTask, timelineGroups, type DragMode, type Task } from '@/lib/tasks'
import { placed, type Placed } from '@/lib/timeline-layout'
import { projectTimelines, timelineProjectDates } from '@/lib/timeline-projects'
import { swallowClick } from '@/lib/swallow-click'
import { daysDragged, HOLD_MS, IDLE, press, released, SLOP, type PressState } from '@/lib/timeline-press'
import { dayWidth, daysToFill, parseZoom, ticks, TOUCH_ZOOMS, type TouchZoom } from '@/lib/timeline-touch'
import { edgeOf, initialLeft, LEAD, leadFor, onScreen, paneLayout, spanFor } from '@/lib/timeline-window'
import { cn } from '@/lib/utils'

// The zoom is a habit of the person, so it is remembered on this device.
// Its own key: the Mac Timeline reads the shared one and has no Day zoom.
const ZOOM_KEY = 'done-timeline-touch-zoom'
const SHARED_ZOOM_KEY = 'done-timeline-zoom'
function storedZoom(): TouchZoom {
  try {
    return parseZoom(localStorage.getItem(ZOOM_KEY), localStorage.getItem(SHARED_ZOOM_KEY))
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
// may be open beside it). Measured before the first paint, and again when
// the element comes back (`mounted` changes).
function useWidth(ref: RefObject<HTMLElement | null>, mounted = true): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, mounted])
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
// this, so a one-day task at quarter zoom (4 px a day) can still be seen.
const INSET = 2
const LEAST_BAR = 10
// Below this a bar has no grips: they would leave nothing to move it by.
const GRIPS_FROM = 22
// The chip in a row whose bar is off screen: its width, and its gap from the edge.
const EDGE_CHIP = 24
const EDGE_GAP = 8
// A task's row, 64 px: its name line on top (6 to 30), its bar under it (34
// to 58). The check's presses stop where the bar is drawn, and the bar's
// where the name line starts, so a press near the bar's edge never completes
// the task. A project's row is 48 px.
const ROW = 'h-16'

export function Timeline() {
  const { data, dragging, edit, update, shown: inScope } = useApp()
  const isMobile = useIsMobile()
  const coarse = useCoarse()
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const rootWidth = useWidth(root)
  const layout = paneLayout(rootWidth)
  const [zoom, setZoomState] = useState<TouchZoom>(storedZoom)
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

  const filter = useTaskFilter()
  const visible = filter.apply(inScope.tasks)
  const groups = timelineGroups(inScope.projects, visible, 'project')
  const open = openTasks(visible)
  const dated = open.filter((t) => t.due || t.start)
  const projectRows = projectTimelines(inScope.projects, visible, filter.filter)
  const timelineDates = [...dated, ...timelineProjectDates(projectRows, TODAY)]
  const undated = open.filter((t) => !t.due && !t.start)
  const shown = open.length
  const total = openTasks(inScope.tasks).length
  // A filter that matches nothing replaces the chart; when it is cleared
  // the chart comes back, scrolled to where it was (or to today).
  const chartShown = !filter.on || shown > 0 || projectRows.length > 0
  // The chart's own width (the view less the No date column, if any): a day
  // is fitted to it, and the names and No date are kept within it.
  const chartWidth = useWidth(scroller, chartShown)
  const px = dayWidth(zoom, chartWidth)
  const tick = ticks(px)

  // Include sprint deadlines in the chart's scroll range, even when the
  // sprint has no dated tasks of its own.
  const datesKey = timelineDates.map((t) => `${"start" in t ? t.start : ""}|${t.due}`).join(',')
  const span = useMemo(() => {
    const need = spanFor(timelineDates, TODAY)
    return { start: need.start, days: daysToFill(need.days, chartWidth, px) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesKey, chartWidth, px])
  const earliest = timelineDates.reduce<Day | null>((first, t) => {
    const day = ("start" in t ? t.start : null) ?? t.due
    return day && (!first || day < first) ? day : first
  }, null)
  const days = useMemo(() => Array.from({ length: span.days }, (_, i) => addDays(span.start, i)), [span.start, span.days])
  const width = span.days * px
  const x = (day: Day) => daysBetween(span.start, day) * px

  // The part of the chart on screen, in days.
  const view = () => {
    const el = scroller.current
    if (!el) return { left: 0, width: 0 }
    return { left: el.scrollLeft / px, width: Math.max(1, el.clientWidth) / px }
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
  // The day in the middle of the chart, kept when the range, the zoom or the
  // width changes; before the first scroll, where the view opens. Only a
  // scroll by the person (or Today) moves it, not one the view makes itself
  // to keep it: a zoom too wide to scroll (Quarter on a phone) must not lose it.
  const focus = useRef<Day | null>(null)
  // The scroll position the view itself last set.
  const placedAt = useRef(-1)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const { width: viewDays } = view()
    const left = focus.current ? daysBetween(span.start, focus.current) + 0.5 - viewDays / 2 : initialLeft(span, TODAY, earliest, viewDays)
    el.scrollLeft = Math.max(0, left) * px
    placedAt.current = el.scrollLeft
    look()
    // Laid out anew whenever the range, the zoom or the panes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span.start, span.days, px, rootWidth, chartShown])
  // Once a frame at most: a finger's scroll fires many events a frame, and
  // the names follow it by themselves (sticky); only the header's range and
  // the off-screen chips need the new position.
  const frame = useRef(0)
  const onScroll = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const { left, width } = look()
      const el = scroller.current
      if (!el || Math.abs(el.scrollLeft - placedAt.current) < 1) return
      placedAt.current = -1
      focus.current = addDays(span.start, Math.floor(left + width / 2))
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  // Brings a day to the left of the chart with the same room before it as
  // when the view opens.
  const showDay = (day: Day) =>
    scroller.current?.scrollTo({ left: Math.max(0, daysBetween(span.start, day) - leadFor(view().width)) * px, behavior: 'smooth' })
  // The day in the middle stays in the middle (`focus`): zooming out from
  // today keeps today on screen.
  const setZoom = (next: TouchZoom) => {
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
  //
  // The rule with the window's long-press menu, as on the Board: drag on
  // move, menu on release in place. A finger's press does not start the
  // window's own long press; a held bar moved past the slop is a drag and no
  // menu opens however long it is held; let go without moving, the task's
  // menu opens there.
  const pressing = useRef<{
    state: PressState
    timer: number
    task: Task
    mode: DragMode
    el: HTMLElement
    pointer: number
    x: number
    y: number
    travelled: boolean
  }>(null)
  const daysMoved = (from: Drag, clientX: number) => daysDragged(clientX - from.x, px, from.mode, from.length)
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
  // The task a tap (or a click) has just let go of, opened by its click.
  const tapped = useRef<number | null>(null)
  const tap = (task: Task) => {
    if (tapped.current !== task.id) return
    tapped.current = null
    edit(task.id)
  }
  const bar = {
    // `holdable` false: the bar is off screen (its name is pinned at the
    // edge), so a hold would move something that cannot be seen. A tap
    // still opens the task, and a hold let go in place its menu.
    down(event: PointerEvent<HTMLElement>, task: Task, holdable: boolean) {
      tapped.current = null
      if (event.button !== 0) return
      const mouse = event.pointerType === 'mouse'
      // The window's long press (its menu) is this view's to give, on letting
      // go of a held bar: it is not started for a finger.
      if (!mouse) event.stopPropagation()
      const grip = (event.target as HTMLElement).dataset.grip
      const mode: DragMode = grip === 'start' || grip === 'end' ? grip : 'move'
      const state: PressState = holdable
        ? press(IDLE, { type: 'down', x: event.clientX, y: event.clientY, pointer: event.pointerType })
        : { kind: 'waiting', x: event.clientX, y: event.clientY }
      const el = event.currentTarget
      const now = { state, timer: 0, task, mode, el, pointer: event.pointerId, x: event.clientX, y: event.clientY, travelled: false }
      pressing.current = now
      if (state.kind === 'dragging') {
        take(task, mode, event.clientX, false)
        el.setPointerCapture(event.pointerId)
        // No text selected under a mouse drag.
        event.preventDefault()
        return
      }
      if (mouse) return
      now.timer = window.setTimeout(() => {
        if (pressing.current !== now) return
        now.state = press(now.state, { type: 'hold' })
        if (now.state.kind !== 'dragging' || !holdable) return
        take(task, mode, now.state.x, true)
        feel({ impact: 'light' })
        try {
          el.setPointerCapture(now.pointer)
        } catch {
          // The finger has already gone; its release ends the press.
        }
      }, HOLD_MS)
    },
    move(event: PointerEvent<HTMLElement>) {
      const now = pressing.current
      if (!now) return
      now.state = press(now.state, { type: 'move', x: event.clientX, y: event.clientY })
      if (now.state.kind === 'scrolling') clearTimeout(now.timer)
      if (Math.hypot(event.clientX - now.x, event.clientY - now.y) > SLOP) now.travelled = true
      if (drag && now.state.kind === 'dragging') setDrag({ ...drag, days: daysMoved(drag, event.clientX) })
    },
    up(event: PointerEvent<HTMLElement>, task: Task) {
      const now = pressing.current
      if (!now) return
      const moved = drag ? daysMoved(drag, event.clientX) : 0
      const mode = drag?.mode ?? 'move'
      const outcome = released(now.state, moved)
      const held = now.state.kind === 'dragging' && now.state.held
      stop()
      // The click that follows a held bar's release is not a tap on what is
      // under the finger: the task, or an item of the menu opened there.
      if (held) swallowClick()
      if (held && !now.travelled) return openMenu(now.el, now.x, now.y)
      // Opened by the click that follows (`tap`), not here: the task's sheet
      // would come up under the finger and that click would land on its
      // backdrop and shut it again.
      if (outcome === 'open') {
        tapped.current = task.id
        return
      }
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

  // The day columns: weekends shaded where there is room to see them, the
  // first of each month marked, today in done's blue.
  const lines = px >= 12
  const columns = (
    <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width }}>
      {days.map((day, i) => {
        const date = toDate(day)
        const weekend = date.getDay() === 0 || date.getDay() === 6
        const monthStart = date.getDate() === 1
        if (!lines && !monthStart) return null
        return (
          <div
            key={day}
            style={{ left: i * px, width: px }}
            className={cn('absolute inset-y-0', lines && 'border-l border-border/50', monthStart && 'border-l border-border', lines && weekend && 'bg-foreground/[0.025]')}
          />
        )
      })}
      <div className="absolute inset-y-0 w-px bg-primary" style={{ left: x(TODAY) + px / 2 }} />
      {dropDay && <div className="absolute inset-y-0 bg-primary/10" style={{ left: x(dropDay), width: px }} />}
    </div>
  )

  // The date header: months above, each name held at the left edge while its
  // days are on screen; days (or Mondays, when a day is narrow) below.
  const months: { day: Day; left: number; right: number }[] = []
  days.forEach((day, i) => {
    if (i === 0 || toDate(day).getDate() === 1) months.push({ day, left: i * px, right: width })
  })
  months.forEach((m, i) => {
    if (i + 1 < months.length) m.right = months[i + 1].left
  })
  const header = (
    <div className="sticky top-0 z-40 h-18 border-b bg-background" style={{ width }}>
      {months.map((m) => (
        <div key={m.day} className="absolute top-1.5 h-5" style={{ left: m.left, width: m.right - m.left }}>
          <span className="sticky left-0 block max-w-full w-max truncate px-2 text-[13px] leading-5 font-semibold text-muted-foreground">
            {toDate(m.day).toLocaleDateString('en-GB', { month: 'long', ...(toDate(m.day).getMonth() === 0 || m.left === 0 ? { year: 'numeric' } : {}) })}
          </span>
        </div>
      ))}
      {days.map((day, i) => {
        const date = toDate(day)
        const isToday = day === TODAY
        if (tick !== 'days' && date.getDay() !== 1 && !isToday) return null
        // A Monday's label right beside today's would run into it.
        if (tick !== 'days' && !isToday && Math.abs(daysBetween(day, TODAY)) * px < 32) return null
        return (
          <div
            key={day}
            data-day={day}
            className={cn('absolute bottom-1.5 flex flex-col items-center gap-1 tabular-nums', tick !== 'days' && !isToday && '-translate-x-1/4')}
            style={{ left: i * px, width: tick === 'days' ? px : undefined }}
          >
            {/* The day of the week: a letter where every day shows, short where only Mondays do. */}
            {tick !== 'dates' && (
              <span className="text-[11px] leading-none text-faint">{date.toLocaleDateString('en-GB', { weekday: tick === 'days' ? 'narrow' : 'short' })}</span>
            )}
            <span
              className={cn(
                'grid h-6 min-w-6 place-content-center rounded-full px-1 text-[13px]',
                isToday ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {date.getDate()}
            </span>
          </div>
        )
      })}
    </div>
  )

  // The names and the rows of No date and of projects are kept within the
  // chart on screen, and pinned to its left as the days scroll under them.
  const nameRoom = Math.max(0, chartWidth - 16)

  // A task's row: its name on a line above, its bar (as long as its days) below.
  const taskRow = ({ task }: Placed) => {
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
    // and brings it into view; its name is held at the same edge above it.
    const edge = moved ? null : edgeOf(span, first, task.due ?? first, seen.left, seen.width)
    const presses = {
      onDown: (e: PointerEvent<HTMLElement>) => bar.down(e, task, !edge),
      onMove: bar.move,
      onUp: (e: PointerEvent<HTMLElement>) => bar.up(e, task),
      onCancel: bar.cancel,
      onTap: () => tap(task),
    }
    return (
      <div key={task.id} className={cn('relative', ROW)} style={{ width }} {...dropTarget}>
        <NameLine task={task} left={left} room={nameRoom} showProject={!byProject} faces={!layout.narrow} {...presses} />
        {edge ? (
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
            className="absolute top-[34px] z-10 grid h-6 place-content-center rounded-md border border-project-edge bg-project-tint text-project after:absolute after:-inset-2.5"
          >
            {edge === 'before' ? <ChevronLeftIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
          </button>
        ) : (
          <TimelineBar task={task} left={left} width={Math.max(barWidth, LEAST_BAR)} range={length > 1} lifted={!!moved && (moved.held || moved.days !== 0)} {...presses} />
        )}
      </div>
    )
  }

  // One task to a row, earliest first.
  const taskRows = (items: Placed[]) =>
    [...items].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.task.id - b.task.id).map(taskRow)
  const placedAll = (tasks: Task[]) => tasks.map((t) => placed(t, 1)).filter((p): p is Placed => p !== null)

  const rows: ReactNode = !byProject
    ? // One timeline for everything, in date order; each name says its project.
      taskRows(placedAll(groups.flatMap((g) => g.tasks)))
    : groups.map((group) => {
        const key = String(group.id ?? 'inbox')
        const items = placedAll(group.tasks)
        // A project with nothing dated is only in No date.
        if (!items.length) return null
        const isFolded = folded.has(key)
        return (
          <div key={key} className="border-b border-border/60">
            {/* The project name and how many of its tasks are on the chart. */}
            <div className="relative h-12" style={{ width }} {...dropTarget}>
              <div className="pointer-events-none absolute inset-0">
                <button
                  type="button"
                  onClick={() => toggleFold(key)}
                  aria-expanded={!isFolded}
                  className="pointer-events-auto sticky left-0 flex h-11 w-max items-center gap-1.5 px-2 text-left text-sm font-medium"
                  style={{ maxWidth: chartWidth }}
                >
                  <ChevronRightIcon className={cn('size-4 shrink-0 text-faint transition-transform', !isFolded && 'rotate-90')} />
                  {group.id !== undefined && <ProjectDot id={group.id} className="shrink-0" />}
                  <span className="min-w-0 truncate">{group.name}</span>
                  <span className="shrink-0 text-xs font-normal text-faint tabular-nums">{items.length}</span>
                </button>
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

  // Under the chart on a narrow screen: a section that opens and shuts, as
  // wide as the chart on screen and held there while the days scroll.
  const undatedSection = !layout.side && undated.length > 0 && (
    <div className="sticky left-0 border-t border-border" style={{ width: chartWidth }}>
      <button
        type="button"
        aria-expanded={undatedOpen}
        onClick={() => setUndatedOpen(!undatedOpen)}
        className="flex h-11 w-full items-center gap-1.5 px-2 text-left text-sm font-medium"
      >
        <ChevronRightIcon className={cn('size-4 shrink-0 text-faint transition-transform', undatedOpen && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">No date</span>
        <span className="shrink-0 text-xs font-normal text-faint tabular-nums">{undated.length}</span>
      </button>
      {undatedOpen && <div className="px-1 pb-2">{undatedList('h-11')}</div>}
    </div>
  )

  // Every control is 44 px high, the least a finger should have to hit.
  const zoomLabels: Record<TouchZoom, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' }
  const controls = (
    <>
      {/* The zoom, always in reach: a segmented control, across the width on a phone held upright. */}
      <div
        role="radiogroup"
        aria-label="Zoom"
        className={cn('flex h-11 shrink-0 gap-0.5 rounded-lg bg-muted p-1', isMobile && 'ml-2.5', isMobile && layout.narrow && 'w-[calc(100%-0.625rem)]')}
      >
        {TOUCH_ZOOMS.map((z) => (
          <button
            key={z}
            type="button"
            role="radio"
            aria-checked={zoom === z}
            // One stop for the keyboard: the chosen zoom; arrows choose another.
            tabIndex={zoom === z ? 0 : -1}
            onClick={() => setZoom(z)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!step) return
              e.preventDefault()
              const next = TOUCH_ZOOMS[(TOUCH_ZOOMS.indexOf(zoom) + step + TOUCH_ZOOMS.length) % TOUCH_ZOOMS.length]
              setZoom(next)
              ;(e.currentTarget.parentElement?.querySelector(`[data-zoom="${next}"]`) as HTMLElement | null)?.focus()
            }}
            data-zoom={z}
            className={cn(
              'relative min-w-14 flex-1 rounded-md px-2.5 text-sm text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-1',
              zoom === z && 'bg-background font-medium text-foreground shadow-sm',
            )}
          >
            {zoomLabels[z]}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={byProject}
        onClick={() => setByProject(!byProject)}
        className={cn('h-11 rounded-lg px-2.5 text-sm font-medium text-muted-foreground', byProject && 'bg-primary/10 text-foreground')}
      >
        By project
      </button>
      <div className="flex items-center [&>button]:h-11 [&>button]:text-sm">
        <FilterButton />
      </div>
      {layout.side && (
        <Button
          variant="ghost"
          className="h-11 text-muted-foreground"
          onClick={() => setPanel(!panel)}
          aria-pressed={panel}
          title={panel ? 'Hide tasks with no date' : 'Show tasks with no date'}
        >
          {panel ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          {undated.length > 0 && <span className="tabular-nums">{undated.length}</span>}
        </Button>
      )}
      {/* The way back to today, in done's blue so it is found at once. */}
      <button type="button" onClick={() => showDay(TODAY)} className={cn('h-11 rounded-lg px-2.5 text-sm font-semibold text-primary', isMobile && 'ml-auto')}>
        Today
      </button>
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
              height: 'calc(100svh - var(--safe-top) - var(--phone-nav) - var(--tab-bar) - var(--safe-bottom))',
              marginBottom: 'calc(var(--tab-bar) - var(--phone-page-end))',
            }
          : undefined
      }
    >
      <ViewHeader title="Timeline" sub={`${shortDay(range[0])} to ${shortDay(range[1])}`}>
        {controls}
      </ViewHeader>
      <FilterBar shown={shown} total={total} />
      {/* On a phone the help goes above the chart: below it, New task would sit on it. */}
      {/* Not on a phone on its side, which needs the height for the chart. */}
      {isMobile && <p className="mb-2 shrink-0 text-xs text-faint [@media(max-height:500px)]:hidden">{help}</p>}

      {!chartShown ? (
        <NothingMatches />
      ) : (
        // At least a few rows high, so a short landscape screen still shows a
        // chart (the page scrolls instead); otherwise it takes what is left.
        <div className="flex min-h-56 min-w-0 flex-1 border-y border-border">
          <div ref={scroller} onScroll={onScroll} data-timeline-scroller className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
            <div className={cn('relative', isMobile && 'pb-20')} style={{ width }}>
              {header}
              <div className="relative">
                {columns}
                <ProjectTimelineRows rows={projectRows} start={span.start} dayWidth={px} width={width} />
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
                {undatedList(coarse ? 'h-11' : 'py-1')}
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

// Set while the Timeline itself opens a task's menu (a held bar let go in
// place), so that one contextmenu is let through to the window's menu.
let openingMenu = false
function openMenu(el: HTMLElement, x: number, y: number) {
  openingMenu = true
  try {
    el.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  } finally {
    openingMenu = false
  }
}

interface Presses {
  onDown: (e: PointerEvent<HTMLElement>) => void
  onMove: (e: PointerEvent<HTMLElement>) => void
  onUp: (e: PointerEvent<HTMLElement>) => void
  onCancel: () => void
  onTap: () => void
}

// A press on a task, by its name or its bar: a tap opens it, a hold lifts its
// bar. A long press of a finger must not also open the window's task menu or
// the text callout; a right click still opens the menu.
function pressHandlers({ onDown, onMove, onUp, onCancel, onTap }: Presses, pointer: { current: string }) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pointer.current = e.pointerType
      onDown(e)
    },
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onCancel,
    onClick: onTap,
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (pointer.current === 'mouse' || openingMenu) return
      e.preventDefault()
      e.stopPropagation()
    },
  }
}

// A finger held still on a control (the check) and let go in place opens the
// task's menu there, as a held bar does; the window's own long press is not
// started, and the click the release sends is eaten so the control is not
// also pressed. A mouse is left alone (its right click opens the menu).
function useHoldMenu() {
  const held = useRef<{ timer: number; x: number; y: number; held: boolean; moved: boolean } | null>(null)
  const pointer = useRef('mouse')
  const end = () => {
    if (held.current) clearTimeout(held.current.timer)
    held.current = null
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pointer.current = e.pointerType
      if (e.pointerType === 'mouse' || e.button !== 0) return
      e.stopPropagation()
      end()
      const now = { timer: 0, x: e.clientX, y: e.clientY, held: false, moved: false }
      now.timer = window.setTimeout(() => {
        now.held = true
        feel({ impact: 'light' })
      }, HOLD_MS)
      held.current = now
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const now = held.current
      if (!now || Math.hypot(e.clientX - now.x, e.clientY - now.y) <= SLOP) return
      now.moved = true
      clearTimeout(now.timer)
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const now = held.current
      end()
      if (!now?.held) return
      swallowClick()
      if (!now.moved) openMenu(e.currentTarget, now.x, now.y)
    },
    onPointerCancel: end,
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (pointer.current === 'mouse' || openingMenu) return
      e.preventDefault()
      e.stopPropagation()
    },
  }
}

// A task's name line, above its bar: the check, the project's dot (on one
// timeline for everything), the name and who is on it. It starts where the
// bar starts and is held on screen (sticky) when the bar runs off either
// side, so the row always says what it is. Pressing the name is pressing the
// task: a tap opens it, a hold moves its bar.
function NameLine({
  task,
  left,
  room,
  showProject,
  faces,
  ...presses
}: { task: Task; left: number; room: number; showProject: boolean; faces: boolean } & Presses) {
  const { edit } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const { on } = useTaskPeople(task)
  const pointer = useRef('mouse')
  const checkHold = useHoldMenu()
  return (
    // The space before the name is a spacer, not a margin: a sticky box may
    // not move over its own margin, so with one it could not be held at the
    // right edge.
    <div className="pointer-events-none absolute inset-x-0 top-1.5 flex h-6">
      <div className="shrink-0" style={{ width: Math.max(0, left) }} />
      <div
        data-task={task.id}
        className={cn(
          // On a wash of the page's colour, so the day lines and today's line do not run through it.
          'pointer-events-auto sticky right-2 left-2 z-20 flex h-6 w-max shrink-0 items-center gap-2 rounded-md bg-background/90 pr-1.5',
          leaving && 'opacity-0 transition-opacity duration-150',
        )}
        style={{ maxWidth: room }}
      >
        {/* The check keeps the row's rule with the menu: a tap completes the
            task, a hold let go in place opens its menu (and completes
            nothing), a hold that moves does neither. */}
        <span className="contents" {...checkHold}>
          <TaskCheck
            task={task}
            checked={leaving}
            onChange={finish}
            // The same variant as TaskCheck's own phone hit area (max-md:), or
            // that one wins and reaches into the bar below.
            className="relative size-5.5 shrink-0 after:absolute after:-inset-x-3 after:-top-[9px] after:-bottom-[5px] max-md:after:-inset-x-3 max-md:after:-top-[9px] max-md:after:-bottom-[5px]"
          />
        </span>
        {showProject && <ProjectDot id={task.projectId} className="shrink-0" />}
        <button
          type="button"
          data-timeline-title
          title={task.title}
          className="min-w-0 cursor-grab truncate text-left text-sm leading-6 font-medium select-none [-webkit-touch-callout:none] [touch-action:pan-x_pan-y]"
          {...pressHandlers(presses, pointer)}
          // A tap opens it through the press handlers; a key (Enter, Space) here.
          onClick={(e) => (e.detail === 0 ? edit(task.id) : presses.onTap())}
        >
          {task.title}
        </button>
        {faces && <Avatars people={on} size="xs" max={2} className="shrink-0" />}
      </div>
    </div>
  )
}

// A task's bar on the chart. Its name is on the line above, so it may be as
// short as its days. Drawn 24 px high; it takes presses from under the name
// line to the row's end (34 px), and the name line presses the same task, so
// a finger has the row's 64 px to aim at.
function TimelineBar({ task, left, width, range, lifted, ...presses }: { task: Task; left: number; width: number; range: boolean; lifted: boolean } & Presses) {
  const { data, noticed } = useApp()
  const pointer = useRef('mouse')
  const grips = width >= GRIPS_FROM
  return (
    <div
      data-task={task.id}
      data-timeline-bar
      // A control to the browser's touch targeting (without it a finger on
      // the bar can be steered to the check above it) and to a screen
      // reader, which hears its dates. Not a second tab stop: the name above
      // it opens the same task.
      role="button"
      tabIndex={-1}
      aria-label={`${task.title}${task.due ? `, ${task.start ? `${fullDay(task.start)} to ` : ''}${fullDay(task.due)}` : ''}`}
      title={`${task.title}${task.due ? `, ${task.start ? `${fullDay(task.start)} to ` : ''}${fullDay(task.due)}` : ''}`}
      style={{ ...projectStyle(data.projects, task.projectId), left, width }}
      className={cn(
        // A pan that starts on a bar still scrolls the chart (touch-action);
        // a held bar stops it from script. No callout or selection on a hold.
        'absolute top-[34px] z-10 h-6 cursor-grab rounded-md border border-project-edge bg-project-tint select-none [-webkit-touch-callout:none] [touch-action:pan-x_pan-y]',
        'after:absolute after:inset-x-0 after:-top-1 after:-bottom-1.5',
        lifted && 'z-20 cursor-grabbing shadow-md ring-2 ring-primary/40',
        noticed === task.id && 'animate-noticed',
      )}
      {...pressHandlers(presses, pointer)}
    >
      {/* The grips: drawn thin at the bar's ends, but each takes a finger's
          width of presses, mostly outside the bar, where its row is empty
          (one task to a row), so a short bar can still be moved by its middle. */}
      {grips && range && (
        <span data-grip="start" className="group/grip absolute -inset-y-2.5 -left-5 z-10 w-[26px] cursor-ew-resize">
          <span className="pointer-events-none absolute inset-y-2.5 right-0 w-1.5 rounded-l-md group-hover/grip:bg-project-edge" />
        </span>
      )}
      {/* Stretched from its end into more days, whatever its length now. */}
      {grips && (
        <span data-grip="end" className="group/grip absolute -inset-y-2.5 -right-5 z-10 w-[26px] cursor-ew-resize">
          <span className="pointer-events-none absolute inset-y-2.5 left-0 w-1.5 rounded-r-md group-hover/grip:bg-project-edge" />
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
      className={cn('flex items-center gap-2 rounded-md px-2 text-sm hover:bg-muted', !coarse && 'cursor-grab active:cursor-grabbing', className)}
    >
      <TaskCheck task={task} checked={leaving} onChange={finish} className="relative shrink-0 size-5.5 after:absolute after:-inset-3" />
      <button type="button" onClick={() => edit(task.id)} className="min-w-0 flex-1 self-stretch truncate text-left">
        {task.title}
      </button>
    </div>
  )
}
