// Board: three columns to drag cards between. The columns are plain elements
// because they are drop targets; the cards and their controls are shadcn's.
// The board takes the height its view has and each column scrolls on its
// own, so every column is a drop target down to the board's bottom (#110).
import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
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
import { FilterBar, FilterButton, NothingMatches, useViewFilter } from '@/components/view-filter'
import { cn } from '@/lib/utils'

const LANES: { key: LaneKey; name: string; hint: string; dot: string }[] = [
  { key: 'todo', name: 'To do', hint: 'Nothing waiting', dot: 'bg-faint' },
  { key: 'doing', name: 'In progress', hint: 'Drag a task here when you start it', dot: 'bg-primary' },
  { key: 'done', name: 'Done today', hint: 'Drag a task here to finish it', dot: 'bg-done' },
]

// What a card does with a pointer on a touch layout (Board's `hold`).
interface Holding {
  down: (event: PointerEvent<HTMLElement>, task: Task) => void
  move: (event: PointerEvent<HTMLElement>) => void
  up: () => void
  cancel: () => void
}

function BoardCard({ task, dragged, onDrag, hold }: { task: Task; dragged: boolean; onDrag: (id: number | null) => void; hold: Holding }) {
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
      onPointerDown={touch ? (event) => hold.down(event, task) : undefined}
      onPointerMove={touch ? hold.move : undefined}
      onPointerUp={touch ? hold.up : undefined}
      onPointerCancel={touch ? hold.cancel : undefined}
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
}

// The card held by a finger, drawn under it while it moves.
interface Lifted {
  task: Task
  x: number
  y: number
  // Where in the card it was taken, and its width, so the copy sits as the card did.
  dx: number
  dy: number
  width: number
}

// Which column is under a point, from the columns' own marks.
const laneAt = (x: number, y: number): LaneKey | null =>
  ((document.elementFromPoint(x, y)?.closest('[data-lane]') as HTMLElement | null)?.dataset.lane as LaneKey | undefined) ?? null

export function Board() {
  const { data, dragging, update, complete } = useApp()
  const isMobile = useIsMobile()
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

  const onDrag = (id: number | null) => {
    setCard(id)
    if (id === null) setOver(null)
    dragging.current = id !== null
  }
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

  // A press on a card on a touch layout. A finger has to hold the card still
  // first (lib/timeline-press, as on the Timeline), or the press is a scroll
  // and is left to the browser. A mouse or trackpad (an iPad's) takes it
  // once it moves, so a click still opens the task.
  const pressing = useRef<{ state: PressState; timer: number; task: Task; el: HTMLElement; pointer: number; mouse: boolean; x: number; y: number }>(null)
  const point = useRef({ x: 0, y: 0 })
  const lift = (now: NonNullable<typeof pressing.current>) => {
    const box = now.el.getBoundingClientRect()
    setLifted({ task: now.task, x: point.current.x, y: point.current.y, dx: now.x - box.left, dy: now.y - box.top, width: box.width })
    onDrag(now.task.id)
    try {
      now.el.setPointerCapture(now.pointer)
    } catch {
      // The finger has already gone; its release ends the press.
    }
  }
  const letGo = () => {
    if (pressing.current) clearTimeout(pressing.current.timer)
    pressing.current = null
    setLifted(null)
    onDrag(null)
  }
  const hold: Holding = {
    down(event, task) {
      if (event.button !== 0 || pressing.current) return
      const mouse = event.pointerType === 'mouse'
      const now = { state: press(IDLE, { type: 'down', x: event.clientX, y: event.clientY, pointer: 'touch' }), timer: 0, task, el: event.currentTarget, pointer: event.pointerId, mouse, x: event.clientX, y: event.clientY }
      pressing.current = now
      point.current = { x: event.clientX, y: event.clientY }
      if (mouse) return
      now.timer = window.setTimeout(() => {
        if (pressing.current !== now) return
        now.state = press(now.state, { type: 'hold' })
        if (now.state.kind !== 'dragging') return
        feel({ impact: 'light' })
        lift(now)
      }, HOLD_MS)
    },
    move(event) {
      const now = pressing.current
      if (!now || event.pointerId !== now.pointer) return
      point.current = { x: event.clientX, y: event.clientY }
      if (now.mouse && now.state.kind === 'waiting' && Math.hypot(event.clientX - now.x, event.clientY - now.y) > SLOP) {
        now.state = { kind: 'dragging', x: now.x, held: false }
        lift(now)
      } else if (!now.mouse) {
        now.state = press(now.state, { type: 'move', x: event.clientX, y: event.clientY })
        if (now.state.kind === 'scrolling') clearTimeout(now.timer)
      }
      if (now.state.kind !== 'dragging') return
      setLifted((l) => l && { ...l, x: event.clientX, y: event.clientY })
      setOver(laneAt(event.clientX, event.clientY))
    },
    up() {
      const now = pressing.current
      if (!now) return
      const lane = now.state.kind === 'dragging' ? laneAt(point.current.x, point.current.y) : null
      letGo()
      // A held card let go where it was taken was a change of mind.
      if (lane && lane !== laneOf(now.task)) moveTo(now.task.id, lane)
    },
    cancel: letGo,
  }

  // While a card is held: the finger's moves must not scroll the page (only
  // a listener that is not passive may say so, and on iOS only on
  // touchmove), and near an edge the column under it, or on a phone the
  // columns themselves, scroll toward that edge.
  const held = lifted !== null
  useEffect(() => {
    if (!held) return
    const still = (event: TouchEvent) => event.preventDefault()
    window.addEventListener('touchmove', still, { passive: false })
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
    return () => {
      window.removeEventListener('touchmove', still)
      cancelAnimationFrame(frame)
    }
  }, [held])
  useEffect(() => () => {
    if (pressing.current) clearTimeout(pressing.current.timer)
  }, [])

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
              height: 'calc(100svh - var(--safe-top) - 2.75rem - 3.0625rem - var(--safe-bottom))',
              marginBottom: 'calc(3.0625rem - 8rem)',
            }
          : undefined
      }
    >
      <ViewHeader title="Board" sub={isMobile ? 'Press and hold a card, then drag it' : 'Drag a card between columns'}>
        <FilterButton />
      </ViewHeader>
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
                <BoardCard key={task.id} task={task} dragged={card === task.id} onDrag={onDrag} hold={hold} />
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
      {lifted && (
        // A copy of the held card, under the finger. The card itself stays
        // in its column, faded, until it is let go.
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-lg border bg-card p-2 pl-9 text-sm shadow-lg ring-2 ring-primary/40"
          style={{ left: lifted.x - lifted.dx, top: lifted.y - lifted.dy, width: lifted.width }}
        >
          <span className="line-clamp-2 wrap-anywhere">{lifted.task.title}</span>
        </div>
      )}
    </div>
  )
}
