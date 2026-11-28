// Board: three columns to drag cards between. The columns are plain elements
// because they are drop targets; the cards and their controls are shadcn's.
// The board takes the height its view has and each column scrolls on its
// own, so every column is a drop target down to the board's bottom (#110).
import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ViewHeader } from '@/components/list-view'
import { ProjectDot } from '@/components/marks'
import { TaskFaces, useTaskPeople } from '@/components/assignees'
import { AddRow } from '@/components/quick-add'
import { TaskCheck, useFinish } from '@/components/task-row'
import { useIsMobile, useIsTouch } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { edgeStep } from '@/lib/board-drag'
import { describeDay, TODAY } from '@/lib/days'
import { feel } from '@/lib/haptics'
import { play } from '@/lib/sounds'
import { HOLD_MS, IDLE, SLOP, press, type PressState } from '@/lib/timeline-press'
import { isSubtask, laneOf, lanes, markOpen, patchTask, projectName, type LaneKey, type Task } from '@/lib/tasks'
import { matchesFilter, isFiltering } from '@/lib/view-filter'
import { setFilterOpen } from '@/lib/view-filter-store'
import { FilterBar, FilterButton, NothingMatches, useViewFilter } from '@/components/view-filter'
import { cn } from '@/lib/utils'

const LANES: { key: LaneKey; name: string; hint: string; dot: string }[] = [
  { key: 'todo', name: 'To do', hint: 'Nothing waiting', dot: 'bg-faint' },
  { key: 'doing', name: 'In progress', hint: 'Drag a task here when you start it', dot: 'bg-primary' },
  { key: 'done', name: 'Done today', hint: 'Drag a task here to finish it', dot: 'bg-done' },
]

// What a card hands the Board on a touch layout: a press, and a menu asked for.
type Press = (event: PointerEvent<HTMLElement>, task: Task) => void
type Menu = (event: MouseEvent<HTMLElement>) => void

// Memoised: while a card is held only the column under it changes, and
// fifty cards need not be drawn again for that.
const BoardCard = memo(function BoardCard({
  task,
  dragged,
  onDrag,
  onPress,
  onMenu,
}: {
  task: Task
  dragged: boolean
  onDrag: (id: number | null) => void
  onPress: Press
  onMenu: Menu
}) {
  const { data, noticed, edit, reopen } = useApp()
  // A mouse drags a card the browser's way. A finger cannot start that, so
  // on an iPhone or iPad every pointer goes through `hold` instead.
  const touch = useIsTouch()
  const [leaving, finish] = useFinish(task.id)
  const done = task.done === true
  const people = useTaskPeople(task).on.length > 0
  const start = (event: DragEvent) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(task.id))
    onDrag(task.id)
  }
  return (
    <Card
      draggable={!touch}
      data-task={task.id}
      onDragStart={start}
      onDragEnd={() => onDrag(null)}
      onPointerDown={touch ? (event) => onPress(event, task) : undefined}
      onContextMenu={touch ? onMenu : undefined}
      className={cn(
        'mb-1 flex-row items-start gap-2.5 rounded-lg p-2 pr-3 shadow-xs',
        // A pan that starts on a card still scrolls; a held card stops it
        // from script. No callout or text selection on a hold.
        'touch:select-none touch:[-webkit-touch-callout:none] touch:[touch-action:pan-x_pan-y]',
        dragged && 'opacity-40',
        noticed === task.id && 'animate-noticed',
        leaving && 'opacity-0 transition-opacity delay-150 duration-150',
      )}
    >
      <TaskCheck task={task} checked={done || leaving} onChange={done ? () => reopen(task.id) : finish} className="mt-px" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Button
          variant="ghost"
          onClick={() => edit(task.id)}
          className={cn(
            'h-auto justify-start rounded-none p-0 text-left font-normal whitespace-normal hover:bg-transparent',
            (done || leaving) && 'text-faint line-through',
          )}
        >
          <span data-findable className="wrap-anywhere">{task.title}</span>
        </Button>
        {(task.goalDay === TODAY || task.due !== null || task.projectId !== null || people) && (
          <div className="flex flex-wrap items-center gap-x-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {task.goalDay === TODAY && <span className="font-medium text-primary">Today’s goal</span>}
            {task.due && <span className={cn(!done && task.due < TODAY && 'text-overdue')}>{describeDay(task.due, TODAY)}</span>}
            {task.projectId !== null && (
              <span className="flex items-center gap-1.5">
                <ProjectDot id={task.projectId} />
                {projectName(data.projects, task.projectId)}
              </span>
            )}
            {/* Who is on it, at the card's bottom right. */}
            <span className="ml-auto">
              <TaskFaces task={task} ring="ring-card" />
            </span>
          </div>
        )}
      </div>
    </Card>
  )
})

// The card held by a finger, drawn under it while it moves.
interface Lifted {
  task: Task
  // The column it was taken from.
  from: LaneKey
  // Where the finger was, and where in the card it took it, and the card's
  // width, so the copy sits as the card did.
  x: number
  y: number
  dx: number
  dy: number
  width: number
}

// A press on a card, from pointerdown to release (Board's `onPress`).
interface Pressing {
  state: PressState
  timer: number
  task: Task
  el: HTMLElement
  pointer: number
  mouse: boolean
  // Where it went down, and whether it has moved since the card lifted.
  x: number
  y: number
  travelled: boolean
}

// Eats the one click the browser sends after a held card is let go, so the
// release is not also a tap on the check or the title under the finger.
function swallowClick() {
  const eat = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
    done()
  }
  const done = () => {
    window.removeEventListener('click', eat, true)
    clearTimeout(timer)
  }
  window.addEventListener('click', eat, true)
  const timer = window.setTimeout(done, 400)
}

// Which column is under a point, from the columns' own marks.
const laneAt = (x: number, y: number): LaneKey | null =>
  ((document.elementFromPoint(x, y)?.closest('[data-lane]') as HTMLElement | null)?.dataset.lane as LaneKey | undefined) ?? null

export function Board() {
  const { data, dragging, update, complete } = useApp()
  const isMobile = useIsMobile()
  const touch = useIsTouch()
  const [card, setCard] = useState<number | null>(null)
  const [over, setOver] = useState<LaneKey | null>(null)
  const [lifted, setLifted] = useState<Lifted | null>(null)
  const board = useRef<HTMLDivElement>(null)
  // The filter only changes what is drawn. Subtasks go through untouched:
  // the board shows top-level tasks, and a subtask is judged with its task.
  const filter = useViewFilter()
  const { shown: { tasks: shownTasks }, me } = useApp()
  const columns = lanes(
    shownTasks.filter((t) => isSubtask(t) || matchesFilter(t, filter, TODAY, me)),
    TODAY,
  )
  const count = (c: Record<LaneKey, Task[]>) => c.todo.length + c.doing.length + c.done.length
  const shown = count(columns)
  const total = count(lanes(shownTasks, TODAY))

  const onDrag = useCallback(
    (id: number | null) => {
      setCard(id)
      if (id === null) setOver(null)
      dragging.current = id !== null
    },
    [dragging],
  )
  const moveTo = (id: number, lane: LaneKey) => {
    // Dropping in Done finishes the task; anywhere else reopens it if needed.
    // Set down where it was picked up: nothing happened, so nothing is heard.
    const from = data.tasks.find((t) => t.id === id)
    if (from && laneOf(from) !== lane && lane !== 'done') play(from.done ? 'reopen' : 'drop')
    if (lane === 'done') complete(id)
    else update((d) => patchTask(markOpen(d, id), id, { status: lane === 'doing' ? 'doing' : undefined }), id)
  }
  const drop = (event: DragEvent, lane: LaneKey) => {
    if (card === null) return
    event.preventDefault()
    moveTo(card, lane)
    onDrag(null)
  }
  // The listeners below are set up once; they reach what is current through this.
  const latest = useRef({ moveTo })
  latest.current = { moveTo }

  // A press on a card on a touch layout. A finger has to hold the card still
  // first (lib/timeline-press, as on the Timeline), or the press is a scroll
  // and is left to the browser. A mouse or trackpad (an iPad's) takes it
  // once it moves, so a click still opens the task.
  // The rule with the card's menu: a held card that is let go without moving
  // opens the menu there; one that moves is dragged, and no menu opens.
  const pressing = useRef<Pressing | null>(null)
  const point = useRef({ x: 0, y: 0 })
  const copy = useRef<HTMLDivElement>(null)
  // Set while this Board itself opens a card's menu, so the menu is let through.
  const opening = useRef(false)
  // The pointer that last pressed a card: a finger's long press must not open
  // the menu by itself (the Board decides), a right click still does.
  const lastPointer = useRef('mouse')

  const stop = useRef<() => void>(() => {})
  const letGo = useCallback(() => stop.current(), [])

  const onPress = useCallback<Press>(
    (event, task) => {
      lastPointer.current = event.pointerType
      const mouse = event.pointerType === 'mouse'
      if (!mouse) {
        // The window's long press (the menu) is the Board's to give: it is
        // not started for a finger here, not even a second finger while a
        // card is held, and comes on letting go of a held card.
        event.stopPropagation()
        // Stopped here, the press never reaches the document, where the
        // iPad's Filter popover listens for a press outside it: it is closed
        // here instead, as that press would have.
        setFilterOpen(false)
      }
      if (event.button !== 0 || pressing.current) return
      const now: Pressing = {
        state: press(IDLE, { type: 'down', x: event.clientX, y: event.clientY, pointer: 'touch' }),
        timer: 0,
        task,
        el: event.currentTarget,
        pointer: event.pointerId,
        mouse,
        x: event.clientX,
        y: event.clientY,
        travelled: false,
      }
      pressing.current = now
      point.current = { x: event.clientX, y: event.clientY }
      const from = laneOf(task)

      const lift = () => {
        const box = now.el.getBoundingClientRect()
        setLifted({ task, from, x: point.current.x, y: point.current.y, dx: now.x - box.left, dy: now.y - box.top, width: box.width })
        onDrag(task.id)
      }
      const move = (e: globalThis.PointerEvent) => {
        if (e.pointerId !== now.pointer) return
        // A mouse whose button came up where the page did not hear it.
        if (now.mouse && e.buttons === 0) return stop.current()
        point.current = { x: e.clientX, y: e.clientY }
        if (now.mouse && now.state.kind === 'waiting') {
          if (Math.hypot(e.clientX - now.x, e.clientY - now.y) <= SLOP) return
          now.state = { kind: 'dragging', x: now.x, held: false }
          now.travelled = true
          lift()
        } else if (!now.mouse) {
          now.state = press(now.state, { type: 'move', x: e.clientX, y: e.clientY })
          if (now.state.kind === 'scrolling') return stop.current()
        }
        if (now.state.kind !== 'dragging') return
        if (!now.travelled && Math.hypot(e.clientX - now.x, e.clientY - now.y) > SLOP) now.travelled = true
        // Moved by hand, not drawn again: only the column under it is state.
        if (copy.current) copy.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
        setOver(laneAt(e.clientX, e.clientY))
      }
      const up = (e: globalThis.PointerEvent) => {
        if (e.pointerId !== now.pointer) return
        const held = now.state.kind === 'dragging'
        const lane = held ? laneAt(point.current.x, point.current.y) : null
        stop.current()
        if (!held) return
        // The click that follows a lifted card's release is not a tap on
        // whatever is under the finger (its check, its title).
        swallowClick()
        if (!now.travelled && !now.mouse) {
          // Held and let go in place: the card's menu, where the finger is.
          opening.current = true
          now.el.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: now.x, clientY: now.y }))
          opening.current = false
          return
        }
        if (lane && lane !== from) latest.current.moveTo(task.id, lane)
      }
      const cancel = (e: globalThis.PointerEvent) => {
        if (e.pointerId === now.pointer) stop.current()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      stop.current = () => {
        clearTimeout(now.timer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        stop.current = () => {}
        if (pressing.current !== now) return
        pressing.current = null
        setLifted(null)
        onDrag(null)
      }
      if (mouse) return
      now.timer = window.setTimeout(() => {
        if (pressing.current !== now) return
        now.state = press(now.state, { type: 'hold' })
        if (now.state.kind !== 'dragging') return
        feel({ impact: 'light' })
        lift()
      }, HOLD_MS)
    },
    [onDrag],
  )
  const onMenu = useCallback<Menu>((event) => {
    if (opening.current || lastPointer.current === 'mouse') return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // While a card is held the finger's moves must not scroll. Only a listener
  // that is not passive may say so, on iOS only one on touchmove, and only
  // one that was there when the touch began: so it is set up once, here.
  useEffect(() => {
    const still = (event: TouchEvent) => {
      if (pressing.current?.state.kind === 'dragging') event.preventDefault()
    }
    window.addEventListener('touchmove', still, { passive: false })
    return () => {
      window.removeEventListener('touchmove', still)
      stop.current()
    }
  }, [])

  // Near an edge the column under a held card, or on a phone the columns
  // themselves, scroll toward that edge.
  const held = lifted !== null
  useEffect(() => {
    if (!held) return
    let frame = 0
    const step = () => {
      const { x, y } = point.current
      const column = document.elementFromPoint(x, y)?.closest('[data-lane]')?.querySelector<HTMLElement>('[data-lane-scroll]')
      if (column) {
        const box = column.getBoundingClientRect()
        column.scrollTop += edgeStep(y, box.top, box.bottom)
      }
      const row = board.current
      if (row && row.scrollWidth > row.clientWidth) {
        const box = row.getBoundingClientRect()
        const by = edgeStep(x, box.left, box.right)
        if (by !== 0) {
          row.scrollLeft += by
          setOver(laneAt(x, y))
        }
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [held])

  // The held card's task left its column under the finger (finished on
  // another device, by an agent): there is nothing left to drag.
  const stillThere = lifted === null || columns[lifted.from].some((t) => t.id === lifted.task.id)
  useEffect(() => {
    if (!stillThere) letGo()
  }, [stillThere, letGo])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={
        isMobile
          ? {
              // A phone's window scrolls, so nothing above bounds this view:
              // it is given the screen from below the navigation bar to the
              // tab bar, as the Timeline is (timeline.tsx), and the page's
              // bottom padding for the tab bar is given back.
              flex: 'none',
              height: 'calc(100svh - var(--safe-top) - var(--phone-nav) - var(--tab-bar) - var(--safe-bottom))',
              marginBottom: 'calc(var(--tab-bar) - var(--phone-page-end))',
            }
          : undefined
      }
    >
      {/* A phone held sideways has little height: its large title and hint
          give way to the columns, and the Filter stays. */}
      <div className="contents phone:[@media(max-height:500px)]:[&_header>h1]:hidden phone:[@media(max-height:500px)]:[&_header>span]:hidden">
        <ViewHeader title="Board" sub={touch ? 'Press and hold a card, then drag it' : 'Drag a card between columns'}>
          <FilterButton />
        </ViewHeader>
      </div>
      <FilterBar shown={shown} total={total} />
      {isFiltering(filter) && shown === 0 ? (
        <NothingMatches />
      ) : (
      <div
        ref={board}
        data-board
        className={cn(
          // Never squeezed to nothing: in a very short window the page scrolls instead.
          'grid min-h-40 flex-1 grid-cols-3 grid-rows-1 gap-3 max-md:min-h-0',
          // A phone has the columns side by side, most of the width each, and
          // is swiped between them; the next column peeks in at the edge.
          'max-md:-mx-4 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:scroll-px-4 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:px-4',
          // A held card scrolls them itself; snapping would pull them back.
          held && 'max-md:snap-none',
        )}
      >
        {LANES.map((lane) => (
          <div
            key={lane.key}
            data-lane={lane.key}
            onDragOver={(event) => {
              if (card === null) return
              event.preventDefault()
              setOver(lane.key)
            }}
            onDrop={(event) => drop(event, lane.key)}
            className={cn(
              'flex min-h-0 flex-col rounded-xl bg-muted p-2 outline-2 -outline-offset-2 outline-transparent transition-colors',
              'max-md:w-[85%] max-md:max-w-sm max-md:shrink-0 max-md:snap-start',
              over === lane.key && 'bg-primary/5 outline-primary',
            )}
          >
            <h3 className="mx-1 mt-1 mb-2 flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span className={cn('size-2 rounded-xs', lane.dot)} />
              {lane.name}
              <span className="font-normal text-faint">{columns[lane.key].length}</span>
            </h3>
            {/* The cards scroll inside the column, its heading held above them. */}
            <div data-lane-scroll className="-mx-2 -mb-2 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-2">
              {columns[lane.key].map((task) => (
                <BoardCard key={task.id} task={task} dragged={card === task.id} onDrag={onDrag} onPress={onPress} onMenu={onMenu} />
              ))}
              {columns[lane.key].length === 0 && <div className="px-2 py-4 text-center text-xs text-faint">{lane.hint}</div>}
            </div>
          </div>
        ))}
      </div>
      )}
      <div className="-mx-2 mt-7 shrink-0 max-md:mt-2">
        <AddRow />
      </div>
      {lifted &&
        // A copy of the held card, under the finger. The card itself stays
        // in its column, faded, until it is let go. Drawn on the body: the
        // page slides in with a transform, which would carry a fixed box
        // inside it off the finger.
        createPortal(
          <div
            ref={copy}
            aria-hidden
            data-board-copy
            className="pointer-events-none fixed top-0 left-0 z-50 rounded-lg border bg-card p-2 pl-9 text-sm shadow-lg ring-2 ring-primary/40"
            style={{ width: lifted.width, marginLeft: -lifted.dx, marginTop: -lifted.dy, transform: `translate(${lifted.x}px, ${lifted.y}px)` }}
          >
            <span className="line-clamp-2 wrap-anywhere">{lifted.task.title}</span>
          </div>,
          document.body,
        )}
    </div>
  )
}
