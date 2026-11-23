// The right-click menu. One menu for the whole app; what it offers depends
// on what was under the pointer: a task, a project, one of the built-in
// views, or empty space.
import {
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { Avatar } from '@/components/avatars'
import { useTaskPeople } from '@/components/assignees'
import { askMove } from '@/lib/move-store'
import { isPersonal, workspaces } from '@/lib/team'
import { PriorityDot } from '@/components/marks'
import { colorStyle, useApp } from '@/lib/app-context'
import { addDays, describeDay, nextWeekday, TODAY, type Day } from '@/lib/days'
import { play } from '@/lib/sounds'
import { expand } from '@/lib/expanded'
import { getFolderPanel, nameFolder, NEW_FOLDER } from '@/lib/note-folder-panel'
import { COLOR_COUNT, colorIndex, isSubtask, patchProject, patchTask, setAssignees, setGoal, toggleAssignee, type Task, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { NO_FILTER } from '@/lib/view-filter'
import { setViewFilter } from '@/lib/view-filter-store'

export type MenuTarget =
  | { kind: 'task'; id: number }
  | { kind: 'project'; id: number }
  | { kind: 'view'; view: Exclude<View['kind'], 'project'> }
  // A note folder in the sidebar; null is All notes.
  | { kind: 'folder'; name: string | null }
  | { kind: 'space' }

// Works out what a right-click landed on from the data attributes the rows,
// cards and sidebar buttons carry.
export function menuTargetOf(element: Element): MenuTarget {
  const task = element.closest<HTMLElement>('[data-task]')
  if (task) return { kind: 'task', id: Number(task.dataset.task) }
  const folder = element.closest<HTMLElement>('[data-note-folder]')
  if (folder) return { kind: 'folder', name: folder.dataset.noteFolder || null }
  const project = element.closest<HTMLElement>('[data-project]')
  if (project) return { kind: 'project', id: Number(project.dataset.project) }
  const view = element.closest<HTMLElement>('[data-view]')
  if (view) return { kind: 'view', view: view.dataset.view as Exclude<View['kind'], 'project'> }
  return { kind: 'space' }
}

// A row of equal choices inside the menu (priority, colour).
const CHOICE = 'flex-1 justify-center bg-muted'

// Who is on a workspace's task, from the menu: each member with a check, and Nobody.
function AssignMenu({ task, change }: { task: Task; change: (fn: Parameters<ReturnType<typeof useApp>['update']>[0], notice?: number) => void }) {
  const { me } = useApp()
  const { space } = useTaskPeople(task)
  if (!space) return null
  const on = task.assignees ?? []
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span className="flex-1">Assign</span>
        <ContextMenuShortcut className="pl-4 tracking-normal">
          {on.length === 0 ? 'Nobody' : on.length === 1 ? (on[0] === me ? 'Me' : (space.members.find((m) => m.id === on[0])?.name.split(' ')[0] ?? '1 person')) : `${on.length} people`}
        </ContextMenuShortcut>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-48">
        {space.members.map((m) => (
          <ContextMenuCheckboxItem key={m.id} checked={on.includes(m.id)} onSelect={() => change((d) => toggleAssignee(d, task.id, m.id), task.id)}>
            <Avatar who={m} size="xs" />
            {m.id === me ? 'Me' : m.name || m.email}
          </ContextMenuCheckboxItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={on.length === 0} onSelect={() => change((d) => setAssignees(d, task.id, []), task.id)}>
          Nobody
        </ContextMenuCheckboxItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

function TaskMenu({ task }: { task: Task }) {
  const { data, me, team, edit, focusOn, complete, reopen, removeTask, update } = useApp()
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
  // A subtask is a line to tick off: it has no date, priority or project of
  // its own to choose here, and cannot be the day's goal.
  if (isSubtask(task)) {
    return (
      <>
        <ContextMenuItem onSelect={() => edit(task.id)}>Edit subtask</ContextMenuItem>
        <ContextMenuItem onSelect={() => complete(task.id)}>Complete</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => removeTask(task.id)}>
          Delete subtask
        </ContextMenuItem>
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
  // Each kind of change is one row that opens on hover, with what it is now
  // on the right; the choices themselves wait in the submenu.
  const now = (text: string) => <ContextMenuShortcut className="pl-4 tracking-normal">{text}</ContextMenuShortcut>
  const spaces = workspaces(team)
  const project = data.projects.find((p) => p.id === task.projectId)
  return (
    <>
      <ContextMenuItem onSelect={() => edit(task.id)}>Edit task</ContextMenuItem>
      {/* Opens the list under the task, where the field to add one is. */}
      <ContextMenuItem onSelect={() => expand(task.id)}>Add subtask</ContextMenuItem>
      <ContextMenuItem onSelect={() => focusOn(task.id)}>Focus on this</ContextMenuItem>
      {task.goalDay === TODAY ? (
        <ContextMenuItem onSelect={() => change((d) => patchTask(d, task.id, { goalDay: null, goalBy: null }))}>Remove as today’s goal</ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => change((d) => setGoal(d, task.id, TODAY, me), task.id)}>Make today’s goal</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="flex-1">Status</span>
          {now(doing ? 'In progress' : 'To do')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-44">
          <ContextMenuCheckboxItem checked={!doing} onSelect={() => change((d) => patchTask(d, task.id, { status: undefined }))}>
            To do
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={doing} onSelect={() => change((d) => patchTask(d, task.id, { status: 'doing' }))}>
            In progress
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => complete(task.id)}>Complete</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="flex-1">Due</span>
          {now(task.due ? describeDay(task.due, TODAY) : 'No date')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-44">
          {due('Today', TODAY)}
          {due('Tomorrow', addDays(TODAY, 1))}
          {due('Next Monday', nextWeekday(TODAY, 1))}
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked={!task.due} onSelect={() => change((d) => patchTask(d, task.id, { start: null, due: null }))}>
            No date
          </ContextMenuCheckboxItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="flex-1">Priority</span>
          {now(task.priority < 4 ? `P${task.priority}` : 'None')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-44">
          {[1, 2, 3, 4].map((p) => (
            <ContextMenuCheckboxItem key={p} checked={task.priority === p} onSelect={() => change((d) => patchTask(d, task.id, { priority: p }))}>
              <PriorityDot priority={p} />
              {p < 4 ? `Priority ${p}` : 'No priority'}
            </ContextMenuCheckboxItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="flex-1">Project</span>
          {now(project?.name ?? 'Inbox')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-[min(28rem,var(--radix-context-menu-content-available-height))] min-w-52 overflow-y-auto">
          {moveTo('Inbox', null)}
          {spaces.length === 0 ? (
            data.projects.map((p) => moveTo(p.name, p.id))
          ) : (
            <>
              {/* Grouped by where they live, as in the sidebar. */}
              <ContextMenuLabel className="text-xs text-muted-foreground">Your projects</ContextMenuLabel>
              {data.projects.filter((p) => isPersonal(p.spaceId, team)).map((p) => moveTo(p.name, p.id))}
              {spaces.map((w) => {
                const in_ = data.projects.filter((p) => p.spaceId === w.id)
                return in_.length ? (
                  <ContextMenuGroup key={w.id}>
                    <ContextMenuSeparator />
                    <ContextMenuLabel className="text-xs text-muted-foreground">{w.name}</ContextMenuLabel>
                    {in_.map((p) => moveTo(p.name, p.id))}
                  </ContextMenuGroup>
                ) : null
              })}
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <AssignMenu task={task} change={change} />
      <ContextMenuSeparator />
      {remove}
    </>
  )
}

// Moving a project to another space: into each workspace it is not in, and
// out of a workspace back to one's own. The dialog that confirms it says who
// gains or loses it (components/move-project.tsx).
function MoveMenu({ id }: { id: number }) {
  const { data, team } = useApp()
  const project = data.projects.find((p) => p.id === id)
  const spaces = workspaces(team)
  if (!project || !team || spaces.length === 0) return null
  const mine = isPersonal(project.spaceId, team)
  const targets = spaces.filter((s) => s.id !== project.spaceId)
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-44">
        {targets.map((s) => (
          <ContextMenuItem key={s.id} onSelect={() => askMove({ project: id, to: s.id })}>
            {s.name}
          </ContextMenuItem>
        ))}
        {!mine && <ContextMenuItem onSelect={() => askMove({ project: id, to: team.personal })}>My own space</ContextMenuItem>}
      </ContextMenuSubContent>
    </ContextMenuSub>
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
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="flex-1">Colour</span>
          {current !== null && <span style={colorStyle(current)} className="mr-1 size-2.5 rounded-xs bg-project" />}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
      <ContextMenuGroup className="grid grid-cols-4 gap-1 p-1">
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
        </ContextMenuSubContent>
      </ContextMenuSub>
      {/* A quick way into a filtered Board or Timeline: only this project. */}
      <ContextMenuSub>
        <ContextMenuSubTrigger>Show only this</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-40">
          <ContextMenuItem
            onSelect={() => {
              setViewFilter({ ...NO_FILTER, projects: [id] })
              openView({ kind: 'board' })
            }}
          >
            On the Board
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setViewFilter({ ...NO_FILTER, projects: [id] })
              openView({ kind: 'timeline' })
            }}
          >
            On the Timeline
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <MoveMenu id={id} />
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => removeProject(id)}>
        Delete project
      </ContextMenuItem>
    </>
  )
}

// A note folder's menu, acting through the Notes page (only open then).
function FolderMenu({ name }: { name: string | null }) {
  const panel = getFolderPanel()
  if (!panel) return null
  return (
    <>
      <ContextMenuItem onSelect={() => panel.select(name)}>Open</ContextMenuItem>
      <ContextMenuItem onSelect={() => panel.newNote(name)}>New note here</ContextMenuItem>
      {name !== null && (
        <>
          <ContextMenuItem onSelect={() => nameFolder(name)}>Rename</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => panel.remove(name)}>
            Delete folder
          </ContextMenuItem>
        </>
      )}
      {name === null && <ContextMenuItem onSelect={() => nameFolder(NEW_FOLDER)}>New folder</ContextMenuItem>}
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
  if (target.kind === 'folder') return <FolderMenu name={target.name} />
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
