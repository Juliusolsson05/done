// Inbox, Today, Upcoming and a project: the views that are a list of tasks.
import { useEffect, useState, type ReactNode } from 'react'
import { NotebookPenIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProjectDot } from '@/components/marks'
import { PhoneHeader } from '@/components/phone'
import { AddRow } from '@/components/quick-add'
import { TaskEditor } from '@/components/task-editor'
import { TaskRow } from '@/components/task-row'
import { useFocus, useNameField } from '@/hooks/use-focus'
import { useIsMobile } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { loadNotes } from '@/lib/backend'
import { fullDay, TODAY } from '@/lib/days'
import { byNewest, isBlank, titleOf, whenText, type Note } from '@/lib/notes'
import { tagOf } from '@/lib/quick-add'
import { play } from '@/lib/sounds'
import { goalTask, patchProject, projectName, sections } from '@/lib/tasks'
import { cn } from '@/lib/utils'

export function ViewHeader({ title, sub, children }: { title: ReactNode; sub?: string; children?: ReactNode }) {
  const isMobile = useIsMobile()
  // A phone has iOS's navigation bar and large title instead.
  if (isMobile) return <PhoneHeader title={title} sub={sub}>{children}</PhoneHeader>
  return (
    // On a phone the heading wraps: the title and what it is about on one
    // line, the view's buttons on the next, where they have room.
    <header className="mb-6 flex min-h-8 items-baseline gap-3 max-md:mb-4 max-md:flex-wrap max-md:gap-y-1">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight max-md:text-3xl md:font-display md:text-[30px] md:leading-tight md:font-semibold md:tracking-[-0.02em]">
        {title}
      </h1>
      {sub && <span className="text-sm whitespace-nowrap text-muted-foreground">{sub}</span>}
      <div className="ml-auto flex gap-1 self-center empty:hidden max-md:-ml-2.5 max-md:basis-full">{children}</div>
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
  const { data, ui, addGoal, focusOn } = useApp()
  const isMobile = useIsMobile()
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
  if (ui.editing === task.id && !isMobile) return <TaskEditor task={task} />
  // No box around it: the label in the colour of done and the title in the
  // display face set it apart, so it needs no card to say it is special.
  return (
    <section aria-label="Today’s goal" className="flex flex-col gap-1 pb-2 md:border-b md:border-border md:pb-5">
      <div className={cn('px-2 text-sm font-medium', task.done ? 'text-faint' : 'text-primary')}>
        {task.done ? 'Today’s goal, done' : 'Today’s goal'}
      </div>
      {task.done ? (
        <div data-findable className="p-2 text-lg font-semibold tracking-tight text-faint line-through">{task.title}</div>
      ) : (
        <>
          <TaskRow task={task} goal />
          <Button variant="ghost" size="sm" className="ml-8 self-start text-primary hover:text-primary" onClick={() => focusOn(task.id)}>
            Start focus
          </Button>
        </>
      )}
    </section>
  )
}

function RenameField({ id, name }: { id: number; name: string }) {
  const { update, closeAll } = useApp()
  const inputRef = useFocus(true)
  const field = useNameField((value) => {
    if (value.trim()) {
      // Leaving the field without changing the name is not a change to confirm.
      if (value.trim() !== name) play('confirm')
      update((d) => patchProject(d, id, { name: value.trim() }))
    }
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
      ? ['No tasks in this project yet', `Add one below, or type @${tagOf(projectName(data.projects, view.id))} when adding a task anywhere.`]
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
              <h3
                className={cn(
                  'mb-1 flex items-baseline gap-2 px-2 text-xs font-semibold max-md:mt-2 max-md:px-1 max-md:text-title max-md:font-bold',
                  section.late ? 'text-overdue' : 'text-muted-foreground max-md:text-foreground',
                )}
              >
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
        {view.kind === 'project' && <ProjectNotes projectId={view.id} />}
      </div>
    </div>
  )
}

// A project's notes, under its tasks. Clicking one opens it in Notes.
function ProjectNotes({ projectId }: { projectId: number }) {
  const { openView } = useApp()
  const [notes, setNotes] = useState<Note[]>([])
  useEffect(() => {
    let current = true
    loadNotes().then(
      (all) => current && setNotes(all.filter((n) => n.projectId === projectId && !isBlank(n.text)).sort(byNewest)),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [projectId])
  if (notes.length === 0) return null
  const now = Date.now()
  return (
    <section>
      <h3 className="mb-1 px-2 text-xs font-semibold text-muted-foreground">Notes</h3>
      {notes.map((note) => (
        <button
          key={note.id}
          type="button"
          onClick={() => openView({ kind: 'notes', id: note.id })}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted max-md:py-2.5"
        >
          <NotebookPenIcon className="size-4 shrink-0 text-faint" />
          <span data-findable className="min-w-0 flex-1 truncate">
            {titleOf(note.text)}
          </span>
          <span className="shrink-0 text-xs text-faint">{whenText(note.updatedAt, now)}</span>
        </button>
      ))}
    </section>
  )
}
