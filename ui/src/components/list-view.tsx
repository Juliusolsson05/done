// Inbox, Today, Upcoming and a project: the views that are a list of tasks.
import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDaysIcon, CheckIcon, NotebookPenIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { ProjectDot } from '@/components/marks'
import { PhoneHeader } from '@/components/phone'
import { AddRow } from '@/components/quick-add'
import { TaskEditor } from '@/components/task-editor'
import { TaskRow } from '@/components/task-row'
import { FilterBar, FilterButton, NothingMatches, useTaskFilter } from '@/components/view-filter'
import { useFocus, useNameField } from '@/hooks/use-focus'
import { useIsMobile, useIsTouch } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { loadNotes } from '@/lib/backend'
import { fullDay, TODAY } from '@/lib/days'
import { byNewest, isBlank, titleOf, whenText, type Note } from '@/lib/notes'
import { tagOf } from '@/lib/quick-add'
import { play } from '@/lib/sounds'
import { goalTask, patchProject, projectName, sections, type Sprint } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// On an iPad with the sidebar put away, the button that brings it back starts
// the header row, as in iPadOS's own bars: it is the only way to the other
// views there, and the page's margin is too narrow to hold a 44 point button
// (it hung off the screen on Board and Timeline, #109). It takes no height of
// its own (-my-1.5), so the header is no taller than before. A Mac keeps its
// button in the page's margin (App.tsx).
function HeaderSidebarToggle() {
  const { open, isMobile } = useSidebar()
  const { ui } = useApp()
  const touch = useIsTouch()
  if (!touch || open || isMobile) return null
  // Timeline and Board's page clips what reaches into its margin, which took
  // the left 12 points of the tap area there, so the button starts at the
  // margin instead of reaching into it.
  const wide = ui.view.kind === 'timeline' || ui.view.kind === 'board'
  return <SidebarTrigger aria-label="Show sidebar" className={cn('-my-1.5 size-11 self-center text-muted-foreground', !wide && '-ml-3')} title="Show sidebar" />
}

export function ViewHeader({ title, sub, children }: { title: ReactNode; sub?: string; children?: ReactNode }) {
  const isMobile = useIsMobile()
  // A phone has iOS's navigation bar and large title instead.
  if (isMobile) return <PhoneHeader title={title} sub={sub}>{children}</PhoneHeader>
  return (
    // On a phone the heading wraps: the title and what it is about on one
    // line, the view's buttons on the next, where they have room.
    <header data-view-header className="mb-6 flex min-h-8 items-baseline gap-3 max-md:mb-4 max-md:flex-wrap max-md:gap-y-1">
      <HeaderSidebarToggle />
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight max-md:text-3xl md:font-display md:text-[30px] md:leading-tight md:font-semibold md:tracking-[-0.02em]">
        {title}
      </h1>
      {sub && <span className="text-sm whitespace-nowrap text-muted-foreground">{sub}</span>}
      <div className="ml-auto flex gap-1 self-center empty:hidden max-md:-ml-2.5 max-md:basis-full pointer-coarse:gap-2">{children}</div>
    </header>
  )
}

// A 44 point button in a list's header on an iPad takes no height of its
// own, as the sidebar button above does, so the header is no taller than a
// Mac's and as many tasks stay in view (#109).
export const IN_HEADER = 'wide:pointer-coarse:-my-1.5'

export function HeaderButton({ danger = false, ...props }: { danger?: boolean; onClick: () => void; children: ReactNode }) {
  // 44 points tall for a finger (they were 28 on iPhone and iPad, #109).
  return <Button variant="ghost" size="sm" className={cn('pointer-coarse:h-11', danger ? 'text-destructive hover:text-destructive' : 'text-muted-foreground')} {...props} />
}

// Today's goal: the one thing that has to happen today. It is the only task
// in the app drawn larger than the others, because it is the only one that
// is more important than the others.
function GoalBlock() {
  const { shown, me, ui, addGoal, focusOn } = useApp()
  const isMobile = useIsMobile()
  const task = goalTask(shown.tasks, TODAY, me)
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
      <div className={cn('px-2 text-sm font-medium max-md:px-0', task.done ? 'text-faint' : 'text-primary')}>
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
  mine: ['Nothing assigned to you', 'When someone in a workspace puts you on a task, it shows up here.'],
}

// Assigned to me, "Only me": just the tasks you are the only one on (Julius,
// 23 Nov). Remembered on this device.
const ONLY_ME = 'done.mine.onlyMe'
function readOnlyMe(): boolean {
  try {
    return localStorage.getItem(ONLY_ME) === '1'
  } catch {
    return false
  }
}

export function ListView() {
  const { data, shown, me, keep, ui, rename, askDelete, closeAll, removeProject, update } = useApp()
  const isMobile = useIsMobile()
  const view = ui.view
  const project = view.kind === 'project' ? data.projects.find((p) => p.id === view.id) : undefined
  const sprint = project?.sprint?.enabled ? project.sprint : undefined
  const changeSprint = (settings: Sprint) => {
    if (project) update((current) => patchProject(current, project.id, { sprint: settings }))
  }
  const [onlyMe, setOnlyMe] = useState(readOnlyMe)
  const toggleOnlyMe = () => {
    const next = !onlyMe
    setOnlyMe(next)
    try {
      localStorage.setItem(ONLY_ME, next ? '1' : '0')
    } catch {
      // Not remembered; it still works for this visit.
    }
  }
  // Assigned to me: the tasks someone put you on, in the scope; with Only me,
  // those you are alone on.
  const source =
    view.kind === 'mine'
      ? shown.tasks.filter((t) => {
          const on = t.assignees ?? []
          return me !== null && on.includes(me) && (!onlyMe || on.length === 1)
        })
      : shown.tasks
  // The filter only changes what is listed; Today's goal, drawn above the
  // list from every task, is never filtered.
  const filter = useTaskFilter()
  const all = sections(view, source, TODAY, keep)
  const list = filter.on ? sections(view, filter.apply(source), TODAY, keep) : all
  const tally = (of: typeof list) => of.reduce((n, s) => n + s.tasks.length, 0)
  const count = tally(list)
  const total = tally(all)
  const addUnderSection = list.some((s) => s.addHere)
  const empty =
    view.kind === 'project'
      ? ['No tasks in this project yet', `Add one below, or type @${tagOf(projectName(data.projects, view.id))} when adding a task anywhere.`]
      : EMPTY[view.kind]
  const hasGoal = view.kind === 'today' && goalTask(shown.tasks, TODAY, me) !== undefined

  return (
    <div className="max-w-3xl">
      {view.kind === 'inbox' && (
        <ViewHeader title="Inbox">
          <FilterButton className={IN_HEADER} />
        </ViewHeader>
      )}
      {view.kind === 'today' && (
        <ViewHeader title="Today" sub={fullDay(TODAY)}>
          <FilterButton className={IN_HEADER} />
        </ViewHeader>
      )}
      {view.kind === 'upcoming' && (
        <ViewHeader title="Upcoming">
          <FilterButton className={IN_HEADER} />
        </ViewHeader>
      )}
      {view.kind === 'mine' && (
        <ViewHeader title="Assigned to me">
          <Button
            variant={onlyMe ? 'secondary' : 'ghost'}
            size="sm"
            className={onlyMe ? 'text-foreground' : 'text-muted-foreground'}
            aria-pressed={onlyMe}
            onClick={toggleOnlyMe}
          >
            Only me
          </Button>
          <FilterButton className={IN_HEADER} />
        </ViewHeader>
      )}
      {view.kind === 'project' && (
        <ViewHeader title={<ProjectTitle id={view.id} />}>
          {/* Every task in it moves, not just those the filter shows. */}
          {ui.confirmDelete ? (
            <>
              <HeaderButton danger onClick={() => removeProject(view.id)}>
                Delete it{total ? ` and move ${total} ${total === 1 ? 'task' : 'tasks'} to Inbox` : ''}
              </HeaderButton>
              <HeaderButton onClick={closeAll}>Keep it</HeaderButton>
            </>
          ) : (
            <>
              <HeaderButton onClick={rename}>Rename</HeaderButton>
              {project && (
                <HeaderButton onClick={() => changeSprint({ enabled: !sprint, deadline: null, completed: false })}>
                  {sprint ? 'Turn off sprint' : 'Make sprint'}
                </HeaderButton>
              )}
              <HeaderButton onClick={askDelete}>Delete project</HeaderButton>
              {!isMobile && <FilterButton className={IN_HEADER} />}
            </>
          )}
        </ViewHeader>
      )}
      {/* On a phone a project's own buttons are behind ⋯ in the bar, so the
          Filter has a row of its own under the title, as other lists have. */}
      {view.kind === 'project' && isMobile && (
        <div className="-mt-1 mb-2 -ml-2.5 flex">
          <FilterButton className={IN_HEADER} />
        </div>
      )}
      {sprint && (
        <section aria-label="Sprint" className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex sm:gap-x-4">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {sprint.completed ? <CheckIcon className="size-4 text-primary" /> : <CalendarDaysIcon className="size-4 text-primary" />}
            {sprint.completed ? 'Sprint complete' : 'Sprint'}
          </div>
          <div className="order-last col-span-2 flex min-w-0 items-center gap-1 sm:order-none">
            <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              Deadline
              <Input
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={sprint.deadline ?? ''}
                onChange={(event) => {
                  if (event.target.validity.valid) changeSprint({ ...sprint, deadline: event.target.value || null })
                }}
                className="h-8 w-auto min-w-0 text-foreground pointer-coarse:h-11"
              />
            </label>
            {sprint.deadline && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear deadline"
                onClick={() => changeSprint({ ...sprint, deadline: null })}
                className="text-muted-foreground pointer-coarse:size-11"
              >
                <XIcon />
              </Button>
            )}
          </div>
          <Button
            variant={sprint.completed ? 'ghost' : 'outline'}
            size="sm"
            onClick={() => changeSprint({ ...sprint, completed: !sprint.completed })}
            className="ml-auto pointer-coarse:h-11"
          >
            {sprint.completed ? 'Reopen sprint' : 'Complete sprint'}
          </Button>
        </section>
      )}
      <FilterBar shown={count} total={total} />

      {/* Rows keep their padding for the hover, so the list is pulled out by
          the same amount and the checks line up with the page title. */}
      {/* On a phone there is no hover, so the list sits on the page's margin.
          An iPad's rows are 44 points for a finger, so its groups sit a
          little closer to keep as many tasks in view (#109). */}
      <div className="-mx-2 flex flex-col gap-7 max-md:mx-0 wide:touch:gap-5">
        {view.kind === 'today' && <GoalBlock />}
        {/* The view's own words when it has no tasks at all; when the
            filter leaves none, that is said instead, with the way back. */}
        {total === 0 && !ui.adding && !hasGoal && (
          <div className="px-2 pt-4 text-muted-foreground">
            <b className="block font-semibold text-foreground">{empty[0]}</b>
            {empty[1]}
          </div>
        )}
        {total > 0 && count === 0 && filter.on && (
          <div className="px-2 max-md:px-0">
            <NothingMatches />
          </div>
        )}
        {list.map((section, i) => (
          <section key={section.heading ?? i}>
            {section.heading && (
              <h3
                className={cn(
                  'mb-1 flex items-baseline gap-2 px-2 text-xs font-semibold max-md:mt-2 max-md:px-0 max-md:text-title max-md:font-bold',
                  section.late ? 'text-overdue' : 'text-muted-foreground max-md:text-foreground',
                  // On a phone a long day of tasks keeps its day in sight
                  // (Upcoming lost which day it was, 23 Nov audit): the heading
                  // stays under the nav bar until the next one pushes it on.
                  'max-md:sticky max-md:top-[calc(var(--safe-top)+2.75rem)] max-md:z-10 max-md:bg-background max-md:py-1',
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
