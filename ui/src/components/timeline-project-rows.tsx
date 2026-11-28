import { ProjectDot } from '@/components/marks'
import { projectStyle, useApp } from '@/lib/app-context'
import { daysBetween, fullDay, shortDay, type Day } from '@/lib/days'
import type { ProjectTimeline } from '@/lib/timeline-projects'

export function SprintCaption({ row }: { row: ProjectTimeline }) {
  const { project, deadline } = row
  if (!project.sprint?.enabled) return null

  const status = project.sprint.completed ? 'Completed sprint' : 'Sprint'
  return <span className="truncate text-xs font-normal text-muted-foreground">{status}{deadline ? ` · Due ${shortDay(deadline)}` : ''}</span>
}

interface TimelineGeometry {
  start: Day
  dayWidth: number
  width: number
}

export function ProjectTimelineMarks({ row, start, dayWidth, width }: TimelineGeometry & { row: ProjectTimeline }) {
  const { data } = useApp()
  const { project, from, to, deadline } = row
  const x = (day: Day) => daysBetween(start, day) * dayWidth
  const left = from ? Math.max(0, x(from)) : 0
  const right = to ? Math.min(width, x(to) + dayWidth) : 0
  const deadlineX = deadline ? x(deadline) : null
  return (
    <div className="absolute inset-0" style={projectStyle(data.projects, project.id)}>
      {from && to && right > left && (
        <span
          role="img"
          aria-label={`${project.name} spans ${fullDay(from)} to ${fullDay(to)}`}
          title={`${shortDay(from)} to ${shortDay(to)}`}
          className="absolute bottom-1.5 block h-1.5 rounded-full bg-project-edge"
          style={{ left, width: right - left }}
        />
      )}
      {deadline && deadlineX !== null && deadlineX >= 0 && deadlineX < width && (
        <span
          role="img"
          aria-label={`${project.name} deadline ${fullDay(deadline)}`}
          title={`Sprint deadline · ${fullDay(deadline)}`}
          className="absolute bottom-1 block size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-project ring-1 ring-background"
          style={{ left: deadlineX + dayWidth / 2 }}
        />
      )}
    </div>
  )
}

export function ProjectTimelineRows({ rows, start, dayWidth, width }: TimelineGeometry & { rows: ProjectTimeline[] }) {
  const { openView } = useApp()
  if (!rows.length) return null

  return (
    <section aria-label="Projects and sprints" className="relative border-b border-border/60">
      {rows.map((row) => (
        <div key={row.project.id} className="relative h-11 border-b border-border/40 last:border-b-0 pointer-coarse:h-14" style={{ width }}>
          <ProjectTimelineMarks row={row} start={start} dayWidth={dayWidth} width={width} />
          <button
            type="button"
            onClick={() => openView({ kind: 'project', id: row.project.id })}
            className="sticky left-0 z-20 flex h-8 max-w-72 items-center gap-1.5 rounded-sm bg-background/95 px-2 text-left text-xs font-medium hover:underline pointer-coarse:h-11"
          >
            <ProjectDot id={row.project.id} className="shrink-0" />
            <span className="truncate">{row.project.name}</span>
            <SprintCaption row={row} />
          </button>
        </div>
      ))}
    </section>
  )
}
