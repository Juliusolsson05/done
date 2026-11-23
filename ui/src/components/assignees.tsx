// Who is on a task: their faces on rows and cards, and the pickers that put
// people on and take them off. Only a workspace's task has people; a task
// in one's own space never offers it.
import { useState } from 'react'
import { CheckIcon, ChevronLeftIcon, SearchIcon, UserPlusIcon, UserXIcon } from 'lucide-react'
import { Avatar, Avatars } from '@/components/avatars'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/app-context'
import { play } from '@/lib/sounds'
import { setAssignees, toggleAssignee, type Task } from '@/lib/tasks'
import { firstName, namesOf, spaceOfTask, workspaceOf, type Member, type Space } from '@/lib/team'
import { cn } from '@/lib/utils'

// The workspace a task is in, and the members on it, in the order they were put on.
export function useTaskPeople(task: Task): { space: Space | undefined; on: Member[] } {
  const { data, team } = useApp()
  const space = workspaceOf(spaceOfTask(task, data), team)
  if (!space) return { space, on: [] }
  // Someone no longer in the workspace is still shown until the server takes them off.
  const on = (task.assignees ?? []).map(
    (id) => space.members.find((m) => m.id === id) ?? { id, name: 'Someone', email: '', picture: '', role: 'member' as const },
  )
  return { space, on }
}

// Faces at the end of a row or card. `ring` is the colour behind them.
export function TaskFaces({ task, ring }: { task: Task; ring?: string }) {
  const { on } = useTaskPeople(task)
  return <Avatars people={on} ring={ring} />
}

// The workspace's name on a task, in All, where tasks of every space are listed together.
export function WorkspaceTag({ task }: { task: Task }) {
  const { scope, ui } = useApp()
  const { space } = useTaskPeople(task)
  // Only where lists are mixed: a project's own page is all one space.
  if (scope !== 'all' || !space || ui.view.kind === 'project') return null
  return <span className="rounded-sm bg-secondary px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground">{space.name}</span>
}

// Members with a check each, and Nobody. Each tap saves, and can be undone.
function MemberChecks({ task, space, query = '', big = false }: { task: Task; space: Space; query?: string; big?: boolean }) {
  const { me, update } = useApp()
  const on = task.assignees ?? []
  const wanted = query.trim().toLowerCase()
  const members = space.members.filter((m) => !wanted || m.name.toLowerCase().includes(wanted) || m.email.toLowerCase().includes(wanted))
  const row = cn('flex w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-accent', big ? 'min-h-11 text-body' : 'h-8 text-sm')
  return (
    <div className="flex flex-col">
      {members.map((m) => {
        const chosen = on.includes(m.id)
        return (
          <button
            key={m.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={chosen}
            onClick={() => {
              play('confirm')
              update((d) => toggleAssignee(d, task.id, m.id))
            }}
            className={row}
          >
            <Avatar who={m} size={big ? 'md' : 'sm'} />
            <span className="min-w-0 flex-1 truncate">{m.name || m.email}</span>
            {m.id === me && <span className="text-xs text-faint">you</span>}
            {chosen && <CheckIcon className="size-4 text-primary" />}
          </button>
        )
      })}
      {members.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nobody by that name is in {space.name}.</p>}
      {!wanted && (
        <button
          type="button"
          onClick={() => {
            play('confirm')
            update((d) => setAssignees(d, task.id, []))
          }}
          className={cn(row, 'mt-1 border-t pt-1 text-muted-foreground')}
        >
          <UserXIcon className="size-4" />
          <span className="flex-1">Nobody</span>
          {on.length === 0 && <CheckIcon className="size-4 text-primary" />}
        </button>
      )}
    </div>
  )
}

// In the task editor: a button saying who is on it, which opens the members.
export function AssigneePicker({ task }: { task: Task }) {
  const { space, on } = useTaskPeople(task)
  const [query, setQuery] = useState('')
  if (!space) return null
  return (
    <Popover onOpenChange={(open) => !open && setQuery('')}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Assignees" className={cn('max-w-56', on.length > 0 && 'border-primary/50')}>
          {on.length ? <Avatars people={on} size="xs" ring="ring-background" /> : <UserPlusIcon />}
          <span className="truncate">{on.length ? namesOf(on.map((m) => firstName(m.name) || m.email)) : 'Assign'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="relative mb-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Assign to…" aria-label="Assign to" className="h-8 pl-8" />
        </div>
        <MemberChecks task={task} space={space} query={query} />
      </PopoverContent>
    </Popover>
  )
}

// On a phone, in the task's details: a row saying who, which opens the
// list of members on a page of its own within the sheet.
export function AssigneeRow({ task, className, onOpen }: { task: Task; className: string; onOpen: () => void }) {
  const { space, on } = useTaskPeople(task)
  if (!space) return null
  return (
    <button type="button" onClick={onOpen} className={cn(className, 'w-full text-left')}>
      <span className="text-body">Assignees</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-body text-tertiary">
        {on.length ? <Avatars people={on} size="xs" ring="ring-background" /> : 'None'}
        <span aria-hidden>›</span>
      </span>
    </button>
  )
}

export function AssigneePage({ task, onBack }: { task: Task; onBack: () => void }) {
  const { space } = useTaskPeople(task)
  if (!space) return null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-11 items-center">
        <button type="button" onClick={onBack} className="flex items-center text-body text-primary active:opacity-40">
          <ChevronLeftIcon className="size-5" />
          Details
        </button>
        <span className="flex-1 pr-16 text-center text-body font-semibold">Assignees</span>
      </div>
      <div className="overflow-hidden rounded-xl bg-background px-2 py-1">
        <MemberChecks task={task} space={space} big />
      </div>
    </div>
  )
}
