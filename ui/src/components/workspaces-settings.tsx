// Settings → Workspaces: making one, and one workspace's page (its people,
// the invites waiting, its projects, and leaving or deleting it). Everything
// here is done on the server; the window catches up after each step.
import { useState, type ReactNode } from 'react'
import { ChevronRightIcon, EllipsisIcon, FolderInputIcon, LinkIcon, MailIcon, PlusIcon } from 'lucide-react'
import { Avatar } from '@/components/avatars'
import { ProjectDot } from '@/components/marks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { canSignIn, isDesktop, workspaceCalls } from '@/lib/backend'
import { useApp } from '@/lib/app-context'
import { askMove } from '@/lib/move-store'
import { play } from '@/lib/sounds'
import { workspaces, type Space } from '@/lib/team'
import { looksLikeEmail, openTaskCount, ownProjects } from '@/lib/workspace-view'
import { cn } from '@/lib/utils'

function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex max-w-2xl flex-col gap-3', className)}>
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  )
}

// A list with a hairline between rows, as Settings draws its lists.
const ROWS = 'flex flex-col border-t border-border'
const ROW = 'flex min-h-12 items-center gap-3 border-b border-border py-2'

function NameForm({ initial, action, onDone, label }: { initial: string; action: string; label: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(initial)
  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onDone(name.trim())
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={label}
        placeholder={label}
        maxLength={60}
        className="flex-1"
      />
      <Button type="submit" disabled={!name.trim()}>
        {action}
      </Button>
      <Button type="button" variant="ghost" onClick={() => onDone(null)}>
        Cancel
      </Button>
    </form>
  )
}

// The pane in Settings: every workspace you are in, and making a new one.
export function WorkspacesPane({ onOpen }: { onOpen: (space: number) => void }) {
  const { team, teamAct, setScope } = useApp()
  const [making, setMaking] = useState(false)
  if (!team) {
    // The desktop app without an account: workspaces live on the server.
    if (isDesktop && canSignIn)
      return (
        <Section title="Workspaces">
          <p className="text-muted-foreground">Sign in to create a workspace or join one. Everything on this device stays yours.</p>
        </Section>
      )
    return null
  }
  const spaces = workspaces(team)
  const create = async (name: string | null) => {
    if (name === null) return setMaking(false)
    let made: number | null = null
    const ok = await teamAct(async () => {
      made = (await workspaceCalls.create(name)).space
    }, `${name} is ready. Invite people from its page.`)
    if (ok && made !== null) {
      play('add')
      setMaking(false)
      setScope(made)
      onOpen(made)
    }
  }
  return (
    <Section title="Workspaces">
      {spaces.length === 0 && (
        <p className="text-muted-foreground">
          Work on projects together. Create a workspace, invite people, and move a project into it. Your other projects stay yours.
        </p>
      )}
      {spaces.length > 0 && (
        <div className={ROWS}>
          {spaces.map((s) => (
            <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={cn(ROW, 'w-full text-left hover:bg-muted/60')}>
              <SpaceMark space={s} />
              <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
              <span className="text-sm text-muted-foreground">
                {s.members.length} {s.members.length === 1 ? 'member' : 'members'}
                {s.role === 'owner' ? ' · Owner' : ''}
              </span>
              <ChevronRightIcon className="size-4 text-faint" />
            </button>
          ))}
        </div>
      )}
      {making ? (
        <NameForm initial="" action="Create" label="Workspace name" onDone={create} />
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setMaking(true)}>
          <PlusIcon />
          Create workspace
        </Button>
      )}
    </Section>
  )
}

// A workspace's mark: its first letter on ink, square-ish, so it is never
// mistaken for a person's round face.
export function SpaceMark({ space, className }: { space: Pick<Space, 'name'>; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background',
        className,
      )}
    >
      {(space.name.trim()[0] ?? '•').toUpperCase()}
    </span>
  )
}

function MemberMenu({ space, id, name }: { space: Space; id: string; name: string }) {
  const { teamAct } = useApp()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`More for ${name}`}>
          <EllipsisIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive"
          onClick={async () => {
            setOpen(false)
            await teamAct(() => workspaceCalls.removeMember(space.id, id), `${name} removed from ${space.name}`)
          }}
        >
          Remove from {space.name}
        </Button>
        <p className="px-3 pb-2 text-xs text-muted-foreground">They lose access at once and are taken off its tasks.</p>
      </PopoverContent>
    </Popover>
  )
}

function Invite({ space }: { space: Space }) {
  const { teamAct } = useApp()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const to = email.trim()
    if (!looksLikeEmail(to)) return
    setBusy(true)
    const ok = await teamAct(() => workspaceCalls.invite(space.id, to), `Invited. ${to} sees it in done, or when they first sign in.`)
    setBusy(false)
    if (ok) setEmail('')
  }
  return (
    <form
      className="flex max-w-2xl gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Google email address"
        aria-label="Google email address to invite"
        autoComplete="off"
        className="flex-1"
      />
      <Button type="submit" disabled={busy || !looksLikeEmail(email)}>
        Invite
      </Button>
    </form>
  )
}

function Waiting({ space }: { space: Space }) {
  const { teamAct, say } = useApp()
  const copy = async (invite: number) => {
    try {
      const { link } = await workspaceCalls.link(invite)
      await navigator.clipboard.writeText(link)
      say('Link copied. It works only for the address it was sent to.')
    } catch {
      say('The link could not be made. Check the connection and try again.')
    }
  }
  const days = (expires: number) => Math.max(0, Math.round((expires - Date.now()) / 86_400_000))
  return space.invites.map((invite) => (
    <div key={invite.id} className={ROW}>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <MailIcon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate">{invite.email}</div>
        <div className="text-xs text-muted-foreground">
          Invited · waiting for them · {days(invite.expires) === 1 ? '1 day left' : `${days(invite.expires)} days left`}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void copy(invite.id)}>
        <LinkIcon />
        Copy link
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => void teamAct(() => workspaceCalls.revoke(invite.id), 'Invite taken back')}
      >
        Revoke
      </Button>
    </div>
  ))
}

function MoveHere({ space }: { space: Space }) {
  const { data, team } = useApp()
  const [open, setOpen] = useState(false)
  const mine = ownProjects(data, team)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="self-start">
          <FolderInputIcon />
          Move a project here
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {mine.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">You have no projects of your own to move.</p>}
        {mine.map((p) => (
          <Button
            key={p.id}
            variant="ghost"
            className="w-full justify-start font-normal"
            onClick={() => {
              setOpen(false)
              askMove({ project: p.id, to: space.id })
            }}
          >
            <ProjectDot id={p.id} className="mx-1" />
            <span className="truncate">{p.name}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function DeleteDialog({ space, open, onClose, onDeleted }: { space: Space; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const { data, teamAct } = useApp()
  const [typed, setTyped] = useState('')
  const projects = data.projects.filter((p) => p.spaceId === space.id)
  const tasks = projects.reduce((n, p) => n + openTaskCount(data, p.id), 0)
  const others = space.members.length - 1
  const sure = typed.trim() === space.name.trim()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTyped('')
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg tracking-[-0.01em]">Delete {space.name}?</DialogTitle>
          <DialogDescription>
            Its {projects.length === 1 ? '1 project' : `${projects.length} projects`}, {tasks === 1 ? '1 open task' : `${tasks} open tasks`} and its
            notes are removed{others > 0 ? ` for you and ${others === 1 ? 'one other person' : `${others} other people`}` : ''}. This cannot be
            undone. To keep a project, move it out first.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>
            Type <b className="font-semibold">{space.name}</b> to confirm
          </span>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Type ${space.name} to confirm`} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={!sure}
            onClick={async () => {
              if (await teamAct(() => workspaceCalls.remove(space.id), `${space.name} deleted`)) onDeleted()
            }}
          >
            Delete {space.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeaveDialog({ space, open, onClose, onLeft }: { space: Space; open: boolean; onClose: () => void; onLeft: () => void }) {
  const { teamAct } = useApp()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg tracking-[-0.01em]">Leave {space.name}?</DialogTitle>
          <DialogDescription>
            Its projects and notes leave every device of yours. Tasks you made stay in {space.name}. To come back, someone has to invite you again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Stay
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await teamAct(() => workspaceCalls.leave(space.id), `You left ${space.name}`)) onLeft()
            }}
          >
            Leave {space.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// One workspace's page, inside Settings.
export function WorkspacePage({ id, onBack }: { id: number; onBack: () => void }) {
  const { team, me, data, teamAct } = useApp()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const space = workspaces(team).find((s) => s.id === id)
  // Gone: deleted, left, or removed meanwhile.
  if (!space) {
    return (
      <div className="max-w-3xl">
        <Crumb onBack={onBack} />
        <p className="text-muted-foreground">This workspace is no longer yours to see.</p>
      </div>
    )
  }
  const owner = space.role === 'owner'
  const projects = data.projects.filter((p) => p.spaceId === space.id)
  const rename = async (name: string | null) => {
    if (name === null || name === space.name) return setRenaming(false)
    if (await teamAct(() => workspaceCalls.rename(space.id, name), 'Renamed')) setRenaming(false)
  }
  return (
    <div className="max-w-3xl">
      <Crumb onBack={onBack} />
      <header className="mb-8 flex min-h-9 items-center gap-3">
        {renaming ? (
          <NameForm initial={space.name} action="Rename" label="Workspace name" onDone={rename} />
        ) : (
          <>
            <SpaceMark space={space} className="size-8 text-sm" />
            <h1 className="font-display text-[30px] leading-tight font-semibold tracking-[-0.02em]">{space.name}</h1>
            {owner && (
              <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => setRenaming(true)}>
                Rename
              </Button>
            )}
          </>
        )}
      </header>
      <div className="flex flex-col gap-9">
        <Section title="Members">
          <Invite space={space} />
          <div className={ROWS}>
            {space.members.map((m) => (
              <div key={m.id} className={ROW}>
                <Avatar who={m} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {m.name || m.email}
                    {m.id === me && <span className="text-faint"> (you)</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                <span className="text-sm text-muted-foreground">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
                {owner && m.id !== me ? <MemberMenu space={space} id={m.id} name={m.name || m.email} /> : <span className="size-8" />}
              </div>
            ))}
            <Waiting space={space} />
          </div>
        </Section>

        <Section title="Projects">
          {projects.length === 0 && (
            <p className="text-muted-foreground">No projects here yet. Move one of yours in, and everyone here can work on it.</p>
          )}
          {projects.length > 0 && (
            <div className={ROWS}>
              {projects.map((p) => {
                const open = openTaskCount(data, p.id)
                return (
                  <div key={p.id} className={ROW}>
                    <ProjectDot id={p.id} className="mx-2" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-sm text-muted-foreground">{open === 1 ? '1 open task' : `${open} open tasks`}</span>
                    {owner && team && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => askMove({ project: p.id, to: team.personal })}
                      >
                        Move out
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <MoveHere space={space} />
        </Section>

        {owner ? (
          <Section title={`Delete ${space.name}`}>
            <p className="text-muted-foreground">Removes its projects, tasks and notes for every member.</p>
            <Button variant="ghost" size="sm" className="-ml-3 self-start text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
              Delete workspace…
            </Button>
          </Section>
        ) : (
          <Section title={`Leave ${space.name}`}>
            <p className="text-muted-foreground">You lose access to its projects and notes on every device. Tasks you made stay in {space.name}.</p>
            <Button variant="ghost" size="sm" className="-ml-3 self-start text-destructive hover:text-destructive" onClick={() => setLeaving(true)}>
              Leave {space.name}…
            </Button>
          </Section>
        )}
      </div>
      <DeleteDialog space={space} open={deleting} onClose={() => setDeleting(false)} onDeleted={onBack} />
      <LeaveDialog space={space} open={leaving} onClose={() => setLeaving(false)} onLeft={onBack} />
    </div>
  )
}

function Crumb({ onBack }: { onBack: () => void }) {
  return (
    <nav className="mb-2 flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
      <button type="button" onClick={onBack} className="hover:text-foreground">
        Settings
      </button>
      <ChevronRightIcon className="size-3.5" />
      <button type="button" onClick={onBack} className="hover:text-foreground">
        Workspaces
      </button>
    </nav>
  )
}
