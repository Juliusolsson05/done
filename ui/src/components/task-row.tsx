import { useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NotesText } from '@/components/notes-text'
import { Subtasks } from '@/components/subtasks'
import { TaskFaces } from '@/components/assignees'
import { SwipeRow } from '@/components/swipe-row'
import { TaskEditor } from '@/components/task-editor'
import { useIsMobile } from '@/hooks/use-mobile'
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
  const { data, ui, noticed, edit, removeTask } = useApp()
  const [leaving, finish] = useFinish(task.id)
  const open = useExpanded(task.id)
  const isMobile = useIsMobile()
  // On a phone the task opens as a sheet over the list (TaskSheet), and the
  // row stays where it is.
  if (ui.editing === task.id && !isMobile) return <TaskEditor task={task} />
  const sub = progress(data.tasks, task.id)

  const view = ui.view.kind
  // The date is left out where the section heading already says it.
  const showDue = task.due !== null && view !== 'upcoming' && !(view === 'today' && task.due === TODAY)
  const row = (
    <div
      data-task={task.id}
      className={cn(
        'group/row flex items-start gap-2.5 rounded-lg p-2 md:hover:bg-muted',
        // A phone: Reminders' row. The text in iOS's body size, a hairline
        // under it that starts where the text starts, and the grey of a
        // row being pressed.
        'max-md:relative max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5 max-md:rounded-none max-md:px-1 max-md:py-3 max-md:active:bg-secondary',
        'max-md:after:absolute max-md:after:right-0 max-md:after:bottom-0 max-md:after:left-9.5 max-md:after:h-px max-md:after:bg-border',
        noticed === task.id && 'animate-noticed',
        leaving && 'opacity-0 transition-opacity delay-150 duration-150',
      )}
    >
      <TaskCheck task={task} checked={leaving} onChange={finish} className={goal ? 'mt-1 size-5' : 'mt-px'} />
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <Button
          variant="ghost"
          onClick={() => edit(task.id)}
          className="h-auto w-full min-w-0 justify-start rounded-none p-0 text-left font-normal whitespace-normal hover:bg-transparent max-md:text-body"
        >
          <span
            data-findable
            className={cn(
              'wrap-anywhere transition-colors',
              // Today's goal is the one task set in the display face: the
              // single biggest thing on the page, because it is the one that matters.
              goal && 'text-lg font-semibold tracking-tight md:font-display md:text-[22px] md:leading-snug md:tracking-[-0.015em]',
              leaving && 'text-faint line-through',
            )}
          >
            {task.title}
          </span>
        </Button>
        {task.notes && <NotesText notes={task.notes} onEdit={() => edit(task.id)} className="truncate" />}
      </div>
      {/* Beside the title in a window. On a phone, on a line of its own under
          it, starting where the title starts: a long title needs the width. */}
      <div
        className={cn(
          'flex items-center gap-3 pl-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums empty:hidden max-md:basis-full max-md:flex-wrap max-md:pl-8.5 max-md:text-subhead max-md:text-tertiary',
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
        {/* On a workspace's task, who is on it. */}
        <TaskFaces task={task} ring={isMobile ? 'ring-background' : 'ring-background group-hover/row:ring-muted'} />
      </div>
    </div>
  )
  return (
    <>
      {isMobile ? (
        <SwipeRow onComplete={finish} onDelete={() => removeTask(task.id)}>
          {row}
        </SwipeRow>
      ) : (
        row
      )}
      {open && !leaving && <Subtasks parent={task} />}
    </>
  )
}
