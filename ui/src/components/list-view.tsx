// Inbox, Today, Upcoming and a project: the views that are a list of tasks.
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ProjectDot } from '@/components/marks'
import { AddRow } from '@/components/quick-add'
import { TaskEditor } from '@/components/task-editor'
import { TaskRow } from '@/components/task-row'
import { useFocus, useNameField } from '@/hooks/use-focus'
import { useApp } from '@/lib/app-context'
import { fullDay, TODAY } from '@/lib/days'
import { tagOf } from '@/lib/quick-add'
import { goalTask, patchProject, projectName, sections } from '@/lib/tasks'
import { cn } from '@/lib/utils'

export function ViewHeader({ title, sub, children }: { title: ReactNode; sub?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex min-h-8 items-baseline gap-3">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">{title}</h1>
      {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
      <div className="ml-auto flex gap-1 self-center">{children}</div>
    </header>
  )
}

export function HeaderButton({ danger = false, ...props }: { danger?: boolean; onClick: () => void; children: ReactNode }) {
  return <Button variant="ghost" size="sm" className={danger ? 'text-destructive hover:text-destructive' : 'text-muted-foreground'} {...props} />
}

// Today's goal: the one thing that has to happen today. It is the only task
// in the app drawn larger than the others, because it is the only one that
// is more important than the others.
function GoalBlock() {
  const { data, ui, addGoal } = useApp()
  const task = goalTask(data.tasks, TODAY)
  if (!task) {
    return (
      <Button
        variant="outline"
        onClick={addGoal}
        className="h-auto w-full flex-col items-start gap-0 rounded-xl border-dashed border-input px-4 py-3 text-left hover:border-primary hover:border-solid hover:bg-background"
      >
        Set today’s goal
        <span className="font-normal text-faint">The one thing that has to happen today</span>
      </Button>
    )
  }
  if (ui.editing === task.id) return <TaskEditor task={task} />
  return (
    <Card className="gap-1 px-2 py-3">
      <div className={cn('px-2 text-xs font-semibold', task.done ? 'text-faint' : 'text-primary')}>
        {task.done ? 'Today’s goal, done' : 'Today’s goal'}
      </div>
      {task.done ? (
        <div className="p-2 text-lg font-semibold tracking-tight text-faint line-through">{task.title}</div>
      ) : (
        <TaskRow task={task} goal />
      )}
    </Card>
  )
}

function RenameField({ id, name }: { id: number; name: string }) {
  const { update, closeAll } = useApp()
  const inputRef = useFocus(true)
  const field = useNameField((value) => {
    if (value.trim()) update((d) => patchProject(d, id, { name: value.trim() }))
    closeAll()
  })
  return <Input ref={inputRef} defaultValue={name} aria-label="Project name" className="h-9 w-80 max-w-full text-2xl font-bold md:text-2xl" {...field} />
}

function ProjectTitle({ id }: { id: number }) {
  const { data, ui } = useApp()
  const name = projectName(data.projects, id)
  if (ui.renaming) return <RenameField id={id} name={name} />
  return (
    <>
      <ProjectDot id={id} className="size-3 rounded-sm" />
      {name}
    </>
  )
}

const EMPTY: Record<string, [string, string]> = {
  inbox: ['Inbox is empty', 'Anything you add without a project lands here.'],
  today: ['Nothing due today', 'Tasks with today’s date show up here, along with anything overdue.'],
  upcoming: ['Nothing scheduled', 'Give a task a date and it appears here, grouped by day.'],
}

export function ListView() {
  const { data, ui, rename, askDelete, closeAll, removeProject } = useApp()
  const view = ui.view
  const list = sections(view, data.tasks, TODAY)
  const count = list.reduce((n, s) => n + s.tasks.length, 0)
  const addUnderSection = list.some((s) => s.addHere)
  const empty =
    view.kind === 'project'
      ? ['No tasks in this project yet', `Add one below, or type #${tagOf(projectName(data.projects, view.id))} when adding a task anywhere.`]
      : EMPTY[view.kind]
  const hasGoal = view.kind === 'today' && goalTask(data.tasks, TODAY) !== undefined

  return (
    <div className="max-w-3xl">
      {view.kind === 'inbox' && <ViewHeader title="Inbox" />}
      {view.kind === 'today' && <ViewHeader title="Today" sub={fullDay(TODAY)} />}
      {view.kind === 'upcoming' && <ViewHeader title="Upcoming" />}
      {view.kind === 'project' && (
        <ViewHeader title={<ProjectTitle id={view.id} />}>
          {ui.confirmDelete ? (
            <>
              <HeaderButton danger onClick={() => removeProject(view.id)}>
                Delete it{count ? ` and move ${count} ${count === 1 ? 'task' : 'tasks'} to Inbox` : ''}
              </HeaderButton>
              <HeaderButton onClick={closeAll}>Keep it</HeaderButton>
            </>
          ) : (
            <>
              <HeaderButton onClick={rename}>Rename</HeaderButton>
              <HeaderButton onClick={askDelete}>Delete project</HeaderButton>
            </>
          )}
        </ViewHeader>
      )}

      {/* Rows keep their padding for the hover, so the list is pulled out by
          the same amount and the checks line up with the page title. */}
      <div className="-mx-2 flex flex-col gap-7">
        {view.kind === 'today' && <GoalBlock />}
        {count === 0 && !ui.adding && !hasGoal && (
          <div className="px-2 pt-4 text-muted-foreground">
            <b className="block font-semibold text-foreground">{empty[0]}</b>
            {empty[1]}
          </div>
        )}
        {list.map((section, i) => (
          <section key={section.heading ?? i}>
            {section.heading && (
              <h3 className={cn('mb-1 flex items-baseline gap-2 px-2 text-xs font-semibold', section.late ? 'text-overdue' : 'text-muted-foreground')}>
                {section.heading}
                {section.detail && !section.detail.startsWith(section.heading) && (
                  <span className="font-normal text-faint">{section.detail}</span>
                )}
              </h3>
            )}
            {section.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
            {view.kind !== 'upcoming' && (section.addHere || (i === list.length - 1 && !addUnderSection)) && <AddRow />}
          </section>
        ))}
        {view.kind === 'upcoming' && <AddRow />}
      </div>
    </div>
  )
}
