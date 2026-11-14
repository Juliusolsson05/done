// Board: three columns to drag cards between. The columns are plain elements
// because they are drop targets; the cards and their controls are shadcn's.
import { useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ViewHeader } from '@/components/list-view'
import { ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { TaskCheck, useFinish } from '@/components/task-row'
import { useApp } from '@/lib/app-context'
import { describeDay, TODAY } from '@/lib/days'
import { lanes, markOpen, patchTask, projectName, type LaneKey, type Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

const LANES: { key: LaneKey; name: string; hint: string; dot: string }[] = [
  { key: 'todo', name: 'To do', hint: 'Nothing waiting', dot: 'bg-faint' },
  { key: 'doing', name: 'In progress', hint: 'Drag a task here when you start it', dot: 'bg-primary' },
  { key: 'done', name: 'Done today', hint: 'Drag a task here to finish it', dot: 'bg-done' },
]

function BoardCard({ task, dragged, onDrag }: { task: Task; dragged: boolean; onDrag: (id: number | null) => void }) {
  const { data, noticed, edit, reopen } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const done = task.done === true
  const start = (event: DragEvent) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(task.id))
    onDrag(task.id)
  }
  return (
    <Card
      draggable
      data-task={task.id}
      onDragStart={start}
      onDragEnd={() => onDrag(null)}
      className={cn(
        'mb-1 flex-row items-start gap-2.5 rounded-lg p-2 pr-3 shadow-xs',
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
          <span className="wrap-anywhere">{task.title}</span>
        </Button>
        {(task.goalDay === TODAY || task.due !== null || task.projectId !== null) && (
          <div className="flex flex-wrap items-center gap-x-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {task.goalDay === TODAY && <span className="font-medium text-primary">Today’s goal</span>}
            {task.due && <span className={cn(!done && task.due < TODAY && 'text-overdue')}>{describeDay(task.due, TODAY)}</span>}
            {task.projectId !== null && (
              <span className="flex items-center gap-1.5">
                <ProjectDot id={task.projectId} />
                {projectName(data.projects, task.projectId)}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

export function Board() {
  const { data, dragging, update, complete } = useApp()
  const [card, setCard] = useState<number | null>(null)
  const [over, setOver] = useState<LaneKey | null>(null)
  const columns = lanes(data.tasks, TODAY)

  const onDrag = (id: number | null) => {
    setCard(id)
    if (id === null) setOver(null)
    dragging.current = id !== null
  }
  const drop = (event: DragEvent, lane: LaneKey) => {
    if (card === null) return
    event.preventDefault()
    // Dropping in Done finishes the task; anywhere else reopens it if needed.
    if (lane === 'done') complete(card)
    else update((d) => patchTask(markOpen(d, card), card, { status: lane === 'doing' ? 'doing' : undefined }), card)
    onDrag(null)
  }

  return (
    <div>
      <ViewHeader title="Board" sub="Drag a card between columns" />
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-3">
        {LANES.map((lane) => (
          <div
            key={lane.key}
            onDragOver={(event) => {
              if (card === null) return
              event.preventDefault()
              setOver(lane.key)
            }}
            onDrop={(event) => drop(event, lane.key)}
            className={cn(
              'min-h-40 rounded-xl bg-muted p-2 outline-2 -outline-offset-2 outline-transparent transition-colors',
              over === lane.key && 'bg-primary/5 outline-primary',
            )}
          >
            <h3 className="mx-1 mt-1 mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span className={cn('size-2 rounded-xs', lane.dot)} />
              {lane.name}
              <span className="font-normal text-faint">{columns[lane.key].length}</span>
            </h3>
            {columns[lane.key].map((task) => (
              <BoardCard key={task.id} task={task} dragged={card === task.id} onDrag={onDrag} />
            ))}
            {columns[lane.key].length === 0 && <div className="px-2 py-4 text-center text-xs text-faint">{lane.hint}</div>}
          </div>
        ))}
      </div>
      <div className="-mx-2 mt-7">
        <AddRow />
      </div>
    </div>
  )
}
