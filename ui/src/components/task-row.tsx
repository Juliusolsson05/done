import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TaskEditor } from '@/components/task-editor'
import { ProjectDot } from '@/components/marks'
import { useApp } from '@/lib/app-context'
import { describeDay, TODAY } from '@/lib/days'
import { projectName, type Task } from '@/lib/tasks'
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
      className={cn('size-4.5 rounded-full', CHECK_TONE[task.priority], className)}
    />
  )
}

export function TaskRow({ task, goal = false }: { task: Task; goal?: boolean }) {
  const { data, ui, noticed, edit } = useApp()
  const [leaving, finish] = useFinish(task.id)
  if (ui.editing === task.id) return <TaskEditor task={task} />

  const view = ui.view.kind
  // The date is left out where the section heading already says it.
  const showDue = task.due !== null && view !== 'upcoming' && !(view === 'today' && task.due === TODAY)
  return (
    <div
      data-task={task.id}
      className={cn(
        'flex items-start gap-2.5 rounded-lg p-2 hover:bg-muted',
        noticed === task.id && 'animate-noticed',
        leaving && 'opacity-0 transition-opacity delay-150 duration-150',
      )}
    >
      <TaskCheck task={task} checked={leaving} onChange={finish} className={goal ? 'mt-1 size-5' : 'mt-px'} />
      <Button
        variant="ghost"
        onClick={() => edit(task.id)}
        className="h-auto min-w-0 flex-1 flex-col items-start gap-0 rounded-none p-0 text-left font-normal whitespace-normal hover:bg-transparent"
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
      <div className={cn('flex items-center gap-3 pl-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums', goal ? 'leading-7' : 'leading-5')}>
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
  )
}
