// The right-click menu. One menu for the whole app; what it offers depends
// on what was under the pointer: a task, a project, one of the built-in
// views, or empty space.
import {
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { PriorityDot } from '@/components/marks'
import { colorStyle, useApp } from '@/lib/app-context'
import { addDays, nextWeekday, TODAY, type Day } from '@/lib/days'
import { play } from '@/lib/sounds'
import { COLOR_COUNT, colorIndex, patchProject, patchTask, setGoal, type Task, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'

export type MenuTarget =
  | { kind: 'task'; id: number }
  | { kind: 'project'; id: number }
  | { kind: 'view'; view: Exclude<View['kind'], 'project'> }
  | { kind: 'space' }

// Works out what a right-click landed on from the data attributes the rows,
// cards and sidebar buttons carry.
export function menuTargetOf(element: Element): MenuTarget {
  const task = element.closest<HTMLElement>('[data-task]')
  if (task) return { kind: 'task', id: Number(task.dataset.task) }
  const project = element.closest<HTMLElement>('[data-project]')
  if (project) return { kind: 'project', id: Number(project.dataset.project) }
  const view = element.closest<HTMLElement>('[data-view]')
  if (view) return { kind: 'view', view: view.dataset.view as Exclude<View['kind'], 'project'> }
  return { kind: 'space' }
}

// A row of equal choices inside the menu (priority, colour).
const CHOICE = 'flex-1 justify-center bg-muted'
const CHOSEN = 'bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground'

function TaskMenu({ task }: { task: Task }) {
  const { data, edit, complete, reopen, removeTask, update } = useApp()
  // Every change made from the menu is confirmed with the same quiet tick.
  const change: typeof update = (fn, notice) => {
    play('confirm')
    update(fn, notice)
  }
  const remove = (
    <ContextMenuItem variant="destructive" onSelect={() => removeTask(task.id)}>
      Delete task
    </ContextMenuItem>
  )
  if (task.done) {
    return (
      <>
        <ContextMenuItem onSelect={() => reopen(task.id)}>Reopen</ContextMenuItem>
        <ContextMenuSeparator />
        {remove}
      </>
    )
  }
  const due = (label: string, day: Day) => (
    <ContextMenuCheckboxItem
      checked={task.due === day && !task.start}
      onSelect={() => change((d) => patchTask(d, task.id, { start: null, due: day }), task.id)}
    >
      {label}
    </ContextMenuCheckboxItem>
  )
  const moveTo = (label: string, projectId: number | null) => (
    <ContextMenuCheckboxItem key={projectId ?? 'inbox'} checked={task.projectId === projectId} onSelect={() => change((d) => patchTask(d, task.id, { projectId }))}>
      {label}
    </ContextMenuCheckboxItem>
  )
  const doing = task.status === 'doing'
  return (
    <>
      <ContextMenuItem onSelect={() => edit(task.id)}>Edit task</ContextMenuItem>
      <ContextMenuItem onSelect={() => complete(task.id)}>Complete</ContextMenuItem>
      {task.goalDay === TODAY ? (
        <ContextMenuItem onSelect={() => change((d) => patchTask(d, task.id, { goalDay: null }))}>Remove as today’s goal</ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => change((d) => setGoal(d, task.id, TODAY), task.id)}>Make today’s goal</ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => change((d) => patchTask(d, task.id, { status: doing ? undefined : 'doing' }))}>
        {doing ? 'Move back to To do' : 'Mark as in progress'}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuLabel>Due</ContextMenuLabel>
      {due('Today', TODAY)}
      {due('Tomorrow', addDays(TODAY, 1))}
      {due('Next Monday', nextWeekday(TODAY, 1))}
      <ContextMenuCheckboxItem checked={!task.due} onSelect={() => change((d) => patchTask(d, task.id, { start: null, due: null }))}>
        No date
      </ContextMenuCheckboxItem>
      <ContextMenuSeparator />
      <ContextMenuLabel>Priority</ContextMenuLabel>
      <ContextMenuGroup className="flex gap-1 p-1">
        {[1, 2, 3, 4].map((p) => (
          <ContextMenuItem
            key={p}
            aria-label={p < 4 ? `Priority ${p}` : 'No priority'}
            className={cn(CHOICE, task.priority === p && CHOSEN)}
            onSelect={() => change((d) => patchTask(d, task.id, { priority: p }))}
          >
            <PriorityDot priority={p} />
            {p < 4 ? p : 'None'}
          </ContextMenuItem>
        ))}
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuLabel>Project</ContextMenuLabel>
      {moveTo('Inbox', null)}
      {data.projects.map((p) => moveTo(p.name, p.id))}
      <ContextMenuSeparator />
      {remove}
    </>
  )
}

function ProjectMenu({ id }: { id: number }) {
  const { data, openView, add, rename, removeProject, update } = useApp()
  const open = () => openView({ kind: 'project', id })
  const current = colorIndex(data.projects, id)
  return (
    <>
      <ContextMenuItem onSelect={open}>Open</ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          open()
          add()
        }}
      >
        Add task here
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          open()
          rename()
        }}
      >
        Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuLabel>Colour</ContextMenuLabel>
      <ContextMenuGroup className="flex gap-1 p-1">
        {Array.from({ length: COLOR_COUNT }, (_, i) => (
          <ContextMenuItem
            key={i}
            aria-label={`Colour ${i + 1}`}
            className={cn(CHOICE, current === i && 'ring-2 ring-primary')}
            onSelect={() => {
              play('confirm')
              update((d) => patchProject(d, id, { color: i }))
            }}
          >
            <span style={colorStyle(i)} className="size-3 rounded-xs bg-project" />
          </ContextMenuItem>
        ))}
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => removeProject(id)}>
        Delete project
      </ContextMenuItem>
    </>
  )
}

export function AppMenu({ target }: { target: MenuTarget }) {
  const { data, openView, add, newProject } = useApp()
  if (target.kind === 'task') {
    const task = data.tasks.find((t) => t.id === target.id)
    if (task) return <TaskMenu task={task} />
  }
  if (target.kind === 'project') return <ProjectMenu id={target.id} />
  if (target.kind === 'view') {
    const open = () => openView({ kind: target.view })
    return (
      <>
        <ContextMenuItem onSelect={open}>Open</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            open()
            add()
          }}
        >
          Add task here
        </ContextMenuItem>
      </>
    )
  }
  return (
    <>
      <ContextMenuItem onSelect={add}>Add task</ContextMenuItem>
      <ContextMenuItem onSelect={newProject}>New project</ContextMenuItem>
    </>
  )
}
