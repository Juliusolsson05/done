// Completed: what has been finished in the scope being looked at, under the
// day it was finished. Ticking the check again puts a task back, as it does
// anywhere else. The filter offers words, project and priority here.
import { useEffect, useState } from 'react'
import { IN_HEADER, ViewHeader } from '@/components/list-view'
import { FilterBar, FilterButton, NothingMatches, useTaskFilter } from '@/components/view-filter'
import { ProjectDot } from '@/components/marks'
import { TaskCheck } from '@/components/task-row'
import { useApp } from '@/lib/app-context'
import { loadFinished } from '@/lib/backend'
import { byFinishedDay } from '@/lib/completed'
import { TODAY } from '@/lib/days'
import { play } from '@/lib/sounds'
import { change } from '@/lib/store'
import { markOpen, projectName, type Task } from '@/lib/tasks'
import { shownFor } from '@/lib/team'
import { recordStep } from '@/lib/undo'
import { cn } from '@/lib/utils'

export function Completed() {
  const { data, scope, team, reopen } = useApp()
  const filter = useTaskFilter()
  const [finished, setFinished] = useState<Task[] | null>(null)

  useEffect(() => {
    const read = () => loadFinished().then(setFinished, () => setFinished((was) => was ?? []))
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const putBack = (task: Task) => {
    setFinished((all) => all && all.filter((t) => t.id !== task.id))
    // Finished today: the window has it, and reopens it the usual way.
    if (data.tasks.some((t) => t.id === task.id)) return reopen(task.id)
    // Finished earlier: the window does not have it, so it is brought in
    // open. Not undone by taking it out of the window again (that would
    // delete it), but by finishing it again on the day it was finished.
    play('reopen')
    change((d) => markOpen({ ...d, tasks: [...d.tasks, task] }, task.id), false)
    recordStep(() => {
      change((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, done: true, doneDay: task.doneDay } : t)) }), false)
      setFinished((all) => all && [task, ...all.filter((t) => t.id !== task.id)].sort((a, b) => (b.doneDay ?? '').localeCompare(a.doneDay ?? '')))
    })
  }

  // Only what is in the scope, as every other list: a finished task's space
  // is its project's, or its own when it has none.
  const inScope = finished ? shownFor({ projects: data.projects, tasks: finished }, scope, team).tasks : null
  const listed = inScope ? filter.apply(inScope) : null
  const groups = listed ? byFinishedDay(listed, TODAY) : []

  return (
    <div className="max-w-3xl">
      <ViewHeader title="Completed" sub={inScope ? `${inScope.length} finished` : undefined}>
        <FilterButton className={IN_HEADER} />
      </ViewHeader>
      <FilterBar shown={listed?.length ?? 0} total={inScope?.length ?? 0} />
      {inScope && inScope.length === 0 && <p className="text-muted-foreground">Nothing finished yet. It shows up here once it is.</p>}
      {inScope && inScope.length > 0 && listed?.length === 0 && filter.on && <NothingMatches />}
      <div className="-mx-2 flex flex-col gap-7">
        {groups.map((group) => (
          <section key={group.day}>
            <h3 className="mb-1 flex items-baseline gap-2 px-2 text-xs font-semibold text-muted-foreground">
              {group.label}
              {!group.detail.startsWith(group.label) && <span className="font-normal text-faint">{group.detail}</span>}
              <span className="ml-auto font-normal text-faint">{group.tasks.length}</span>
            </h3>
            {group.tasks.map((task) => (
              <div
                key={task.id}
                data-task={task.id}
                className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted max-md:gap-3 max-md:py-2.5"
              >
                <TaskCheck task={task} checked onChange={() => putBack(task)} className="mt-0.5" />
                <span data-findable className={cn('min-w-0 flex-1 wrap-anywhere text-muted-foreground line-through decoration-faint')}>
                  {task.title}
                </span>
                {task.projectId !== null && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
                    <ProjectDot id={task.projectId} />
                    {projectName(data.projects, task.projectId)}
                  </span>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
