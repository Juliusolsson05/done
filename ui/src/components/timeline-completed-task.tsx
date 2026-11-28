import { CheckIcon } from 'lucide-react'
import { ProjectDot } from '@/components/marks'
import { projectStyle, useApp } from '@/lib/app-context'
import { daysBetween, shortDay, type Day } from '@/lib/days'
import type { Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

export function TimelineCompletedTask({
  task,
  start,
  dayWidth,
  width,
  showProject,
  afterProjectColumn = false,
}: {
  task: Task
  start: Day
  dayWidth: number
  width: number
  showProject: boolean
  afterProjectColumn?: boolean
}) {
  const { data } = useApp()
  if (!task.doneDay) return null

  const x = (day: Day) => (daysBetween(start, day) + 0.5) * dayWidth
  const doneX = x(task.doneDay)
  const dueX = task.due ? x(task.due) : doneX
  const left = Math.max(0, Math.min(doneX, dueX))
  const right = Math.min(width, Math.max(doneX, dueX))
  const onChart = (point: number) => point >= 0 && point < width
  const offset = task.due ? daysBetween(task.due, task.doneDay) : 0
  const days = Math.abs(offset)
  const timing = !task.due ? 'No due date' : offset === 0 ? 'On time' : `${days} ${days === 1 ? 'day' : 'days'} ${offset < 0 ? 'early' : 'late'}`
  const due = task.due ? `Due ${shortDay(task.due)}` : null
  const done = `Done ${shortDay(task.doneDay)}`
  const caption = [done, due, timing].filter(Boolean).join(' · ')

  return (
    <div
      data-timeline-completed={task.id}
      title={`${task.title} · ${caption}`}
      className="absolute inset-0 overflow-clip text-muted-foreground"
      style={projectStyle(data.projects, task.projectId)}
    >
      <div className={cn(
        'sticky top-0 grid w-max max-w-[min(16rem,100%)] gap-0.5 bg-background/90 px-2 py-0.5 text-xs leading-tight',
        afterProjectColumn ? 'left-52 max-md:left-32' : 'left-0',
      )}>
        <div className="flex min-w-0 items-center gap-1.5">
          {showProject && task.projectId !== null && <ProjectDot id={task.projectId} />}
          <span data-findable className="truncate">{task.title}</span>
        </div>
        <span className="text-[10px] font-normal">{caption}</span>
      </div>
      {right > left && (
        <span
          aria-hidden
          data-timeline-completion-connector
          className="absolute bottom-2 border-t border-dashed border-project/70"
          style={{ left, width: right - left }}
        />
      )}
      {task.due && offset !== 0 && onChart(dueX) && (
        <span
          aria-hidden
          className="absolute bottom-[5px] h-2 w-px bg-project"
          style={{ left: dueX }}
        />
      )}
      {onChart(doneX) && (
        <CheckIcon
          aria-hidden
          className="absolute bottom-0.5 size-3.5 -translate-x-1/2 rounded-full bg-background text-project"
          style={{ left: doneX }}
        />
      )}
    </div>
  )
}
