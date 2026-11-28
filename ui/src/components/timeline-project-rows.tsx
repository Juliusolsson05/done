import type { ReactNode } from 'react'
import { ProjectDot } from '@/components/marks'
import { projectStyle, useApp } from '@/lib/app-context'
import { daysBetween, fullDay, shortDay, type Day } from '@/lib/days'
import type { ProjectTimeline } from '@/lib/timeline-projects'

export function ProjectTimelineRows({ rows, start, dayWidth, width, leading }: {
  rows: ProjectTimeline[]
  start: Day
  dayWidth: number
  width: number
  leading?: ReactNode
}) {
  const { data, openView } = useApp()
  const x = (day: Day) => daysBetween(start, day) * dayWidth
  if (!rows.length) return null

  return (
    <section aria-label="Projects and sprints" className="relative border-b border-border/60">
      {rows.map(({ project, from, to, deadline }) => {
        const sprint = project.sprint?.enabled ? project.sprint : undefined
        const name = project.name
        const left = from ? Math.max(0, x(from)) : 0
        const right = to ? Math.min(width, x(to) + dayWidth) : 0
        const deadlineX = deadline ? x(deadline) : null
        return (
          <div key={project.id} className="flex border-b border-border/40 last:border-b-0">
            {leading}
            <div className="relative h-11 shrink-0 pointer-coarse:h-14" style={{ ...projectStyle(data.projects, project.id), width }}>
              <button
                type="button"
                onClick={() => openView({ kind: 'project', id: project.id })}
                className="sticky left-0 z-20 flex h-8 max-w-60 items-center gap-1.5 rounded-sm bg-background/95 px-2 text-left text-xs font-medium hover:underline pointer-coarse:h-11"
              >
                <ProjectDot id={project.id} className="shrink-0" />
                <span className="truncate">{name}</span>
                {sprint && <span className="shrink-0 font-normal text-muted-foreground">{sprint.completed ? 'Completed sprint' : 'Sprint'}</span>}
                {deadline && <span className="shrink-0 font-normal text-muted-foreground">Due {shortDay(deadline)}</span>}
              </button>
              {from && to && right > left && (
                <span
                  role="img"
                  aria-label={`${name} spans ${fullDay(from)} to ${fullDay(to)}`}
                  title={`${shortDay(from)} to ${shortDay(to)}`}
                  className="absolute bottom-1.5 block h-1.5 rounded-full bg-project-edge"
                  style={{ left, width: right - left }}
                />
              )}
              {deadline && deadlineX !== null && deadlineX >= 0 && deadlineX < width && (
                <span
                  role="img"
                  aria-label={`${name} deadline ${fullDay(deadline)}`}
                  title={`Sprint deadline · ${fullDay(deadline)}`}
                  className="absolute bottom-1 block size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-project ring-1 ring-background"
                  style={{ left: deadlineX + dayWidth / 2 }}
                />
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
