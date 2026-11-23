// The workspace picker: where you are. All (the default), your own space,
// or one workspace. At the bottom of the sidebar in a window, at the top of
// Lists on a phone; shown only once you are in a workspace.
import { useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, LayersIcon, PlusIcon } from 'lucide-react'
import { Avatar, Avatars } from '@/components/avatars'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/app-context'
import { play } from '@/lib/sounds'
import { workspaces, type Scope, type Space } from '@/lib/team'
import { cn } from '@/lib/utils'

// A workspace's mark: its first letter on a dark square, as in the mock.
export function SpaceMark({ space, className }: { space: Pick<Space, 'name'>; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-foreground text-[10px] font-semibold text-background',
        className,
      )}
    >
      {space.name.trim().slice(0, 1).toUpperCase() || '•'}
    </span>
  )
}

function AllMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-secondary text-foreground', className)}>
      <LayersIcon className="!size-3" />
    </span>
  )
}

// What the picker says about where you are.
function useHere() {
  const { team, me, scope } = useApp()
  const spaces = workspaces(team)
  const you = team?.spaces.flatMap((s) => s.members).find((m) => m.id === me)
  const here = typeof scope === 'number' ? spaces.find((s) => s.id === scope) : undefined
  return { spaces, you, here }
}

export function SpacePicker({ phone = false }: { phone?: boolean }) {
  const { scope, setScope, openView, team } = useApp()
  const [open, setOpen] = useState(false)
  const { spaces, you, here } = useHere()
  if (!team || spaces.length === 0) return null

  const choose = (next: Scope) => {
    setOpen(false)
    if (next !== scope) play('open')
    setScope(next)
  }
  const row = (key: string, chosen: boolean, mark: React.ReactNode, name: string, side: React.ReactNode, onClick: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitemradio"
      aria-checked={chosen}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        phone && 'h-11 text-body',
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-xs text-faint">{side}</span>
      {chosen ? <CheckIcon className="size-4 shrink-0 text-primary" /> : <span className="size-4 shrink-0" />}
    </button>
  )

  const [mark, name, sub] =
    scope === 'all'
      ? [<AllMark key="m" />, 'All', 'You and ' + (spaces.length === 1 ? spaces[0].name : `${spaces.length} workspaces`)]
      : scope === 'personal'
        ? [you ? <Avatar key="m" who={you} /> : <AllMark key="m" />, you?.name || 'You', 'Only you']
        : [<SpaceMark key="m" space={here ?? { name: '?' }} />, here?.name ?? '', `${here?.members.length ?? 0} members`]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Showing ${name}. Choose what to show`}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2 text-left font-medium hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
            phone ? 'h-14 rounded-xl bg-background px-3.5 text-body' : 'h-10 text-sm',
          )}
        >
          {mark}
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate">{name}</span>
            <span className={cn('truncate font-normal text-faint', phone ? 'text-subhead' : 'text-[11.5px]')}>{sub}</span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={phone ? 'bottom' : 'top'} align="start" className={cn('w-60 p-1.5', phone && 'w-[calc(100vw-2rem)]')} role="menu">
        {row('all', scope === 'all', <AllMark />, 'All', '', () => choose('all'))}
        {row('personal', scope === 'personal', you ? <Avatar who={you} /> : <AllMark />, you?.name || 'You', 'Only you', () => choose('personal'))}
        <div className="mx-1 my-1.5 h-px bg-border" />
        <div className="px-2 pt-1 pb-0.5 text-[11.5px] font-medium text-faint">Workspaces</div>
        {spaces.map((s) =>
          row(String(s.id), scope === s.id, <SpaceMark space={s} />, s.name, <Avatars people={s.members} size="xs" ring="ring-popover" />, () =>
            choose(s.id),
          ),
        )}
        <div className="mx-1 my-1.5 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            openView({ kind: 'settings' })
          }}
          className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent"
        >
          <PlusIcon className="size-4" />
          Create workspace
        </button>
      </PopoverContent>
    </Popover>
  )
}
