import { useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Subtasks } from '@/components/subtasks'
import { TaskEditor } from '@/components/task-editor'
import { ProjectDot } from '@/components/marks'
import { useApp } from '@/lib/app-context'
import { describeDay, TODAY } from '@/lib/days'
import { toggleExpanded, useExpanded } from '@/lib/expanded'
import { progress, projectName, type Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// Finishing is shown before the row goes: the check fills and the title is
// struck through, then the task is marked done. `leaving` is true in between.
export function useFinish(id: number): [leaving: boolean, finish: () => void] {
  const { complete, completeSound } = useApp()
  const [leaving, setLeaving] = useState(false)
  const finish = () => {
    if (leaving) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return complete(id)
    // Heard with the press, not when the row has finished fading.
    completeSound(id)
    setLeaving(true)
    setTimeout(() => {
      setLeaving(false)
      complete(id, true)
    }, 280)
  }
  return [leaving, finish]
}

const CHECK_TONE: Record<number, string> = {
  1: 'border-priority-1 bg-priority-1/10',
  2: 'border-priority-2 bg-priority-2/10',
  3: 'border-priority-3 bg-priority-3/10',
  4: 'border-faint',
}
// The round check in front of every task, edged in its priority colour.
export function TaskCheck({ task, checked, onChange, className }: { task: Task; checked: boolean; onChange: () => void; className?: string }) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onChange}
      aria-label={`${task.done ? 'Reopen' : 'Complete'}: ${task.title}`}
      // On a phone the circle is a little larger, and the area that takes a
      // tap is larger still (the ::after), so a thumb does not have to aim.
      className={cn('relative size-4.5 rounded-full max-md:size-5.5 max-md:after:absolute max-md:after:-inset-3', CHECK_TONE[task.priority], className)}
    />
  )
}

export function TaskRow({ task, goal = false }: { task: Task; goal?: boolean }) {
  const { data, ui, noticed, edit } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const open = useExpanded(task.id)
  if (ui.editing === task.id) return <TaskEditor task={task} />
  const sub = progress(data.tasks, task.id)

  const view = ui.view.kind
  // The date is left out where the section heading already says it.
  const showDue = task.due !== null && view !== 'upcoming' && !(view === 'today' && task.due === TODAY)
  return (
    <>
    <div
      data-task={task.id}
      className={cn(
        'flex items-start gap-2.5 rounded-lg p-2 hover:bg-muted max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5 max-md:px-1 max-md:py-2.5',
        noticed === task.id && 'animate-noticed',
        leaving && 'opacity-0 transition-opacity delay-150 duration-150',
      )}
    >
      <TaskCheck task={task} checked={leaving} onChange={finish} className={goal ? 'mt-1 size-5' : 'mt-px'} />
      <Button
        variant="ghost"
        onClick={() => edit(task.id)}
        className="h-auto min-w-0 flex-1 flex-col items-start gap-0 rounded-none p-0 text-left font-normal whitespace-normal hover:bg-transparent max-md:text-base max-md:leading-snug"
      >
        <span
          className={cn(
            'wrap-anywhere transition-colors',
            goal && 'text-lg font-semibold tracking-tight',
            leaving && 'text-faint line-through',
          )}
        >
          {task.title}
        </span>
        {task.notes && <span className="w-full truncate text-xs text-muted-foreground">{task.notes}</span>}
      </Button>
      {/* Beside the title in a window. On a phone, on a line of its own under
          it, starting where the title starts: a long title needs the width. */}
      <div
        className={cn(
          'flex items-center gap-3 pl-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums empty:hidden max-md:basis-full max-md:flex-wrap max-md:pl-8.5 max-md:leading-5',
          goal ? 'leading-7' : 'leading-5',
        )}
      >
        {/* Shown whenever there are subtasks, or the list is open to add the
            first one: the count is also how the list is opened and closed. */}
        {(sub || open) && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-label={open ? 'Hide subtasks' : 'Show subtasks'}
            onClick={() => toggleExpanded(task.id)}
            className="h-5 gap-1 px-1.5 text-xs font-normal text-muted-foreground tabular-nums max-md:-ml-1.5 max-md:h-7 max-md:text-sm"
          >
            <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            {sub ? `${sub.done}/${sub.total}` : 'Subtasks'}
          </Button>
        )}
        {task.goalDay === TODAY && view !== 'today' && <span className="font-medium text-primary">Today’s goal</span>}
        {task.status === 'doing' && <span>In progress</span>}
        {showDue && task.due && <span className={cn(task.due < TODAY && 'text-overdue')}>{describeDay(task.due, TODAY)}</span>}
        {task.projectId !== null && view !== 'project' && (
          <span className="flex items-center gap-1.5 max-md:hidden">
            <ProjectDot id={task.projectId} />
            {projectName(data.projects, task.projectId)}
          </span>
        )}
      </div>
    </div>
    {open && !leaving && <Subtasks parent={task} />}
    </>
  )
}
