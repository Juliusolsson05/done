// The bell and what is under it: invites waiting for an answer, tasks
// someone gave you, and people joining your workspace. Nothing is ever sent
// by email; this is where news arrives. Only for a window with an account.
import { useEffect, useState } from 'react'
import { BellIcon } from 'lucide-react'
import { Avatar } from '@/components/avatars'
import { ViewHeader } from '@/components/list-view'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { workspaceCalls } from '@/lib/backend'
import { useApp } from '@/lib/app-context'
import { caughtUp } from '@/lib/store'
import { unread, type Notice } from '@/lib/team'
import { noticeDetail, noticeParts, sortNotices } from '@/lib/workspace-view'
import { cn } from '@/lib/utils'

// Opening the list counts as reading it. Quietly: a failure here costs
// nothing but a count that stays a little longer.
function markRead(count: number) {
  if (count === 0) return
  void workspaceCalls
    .read()
    .then(() => caughtUp())
    .catch(() => {})
}

function NoticeRow({ notice, onDone }: { notice: Notice; onDone?: () => void }) {
  const { teamAct, setScope, reveal } = useApp()
  const [busy, setBusy] = useState(false)
  const words = noticeParts(notice)
  const who = { id: notice.by.id ?? notice.id, name: notice.by.name ?? '', email: '', picture: notice.by.picture ?? '' }
  const open = notice.kind === 'assigned' && notice.task != null
  const act = async (run: () => Promise<unknown>, said: string) => {
    setBusy(true)
    const ok = await teamAct(run, said)
    setBusy(false)
    if (ok) onDone?.()
  }
  const body = (
    <>
      <Avatar who={who} size="md" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col items-start text-left">
        <p className="leading-snug">
          <b className="font-semibold">{words.who}</b> {words.did} <b className="font-semibold">{words.what}</b>
        </p>
        <p className="mt-0.5 text-xs text-faint">{noticeDetail(notice, Date.now())}</p>
        {notice.kind === 'invite' && notice.invite != null && (
          <div className="mt-2 flex gap-1.5">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                act(
                  async () => {
                    const joined = await workspaceCalls.accept(notice.invite!)
                    // Straight into it: that is what joining was for.
                    setScope(joined.space)
                  },
                  `You joined ${notice.spaceName ?? 'the workspace'}`,
                )
              }
            >
              Join {notice.spaceName}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => workspaceCalls.decline(notice.invite!), 'Invite declined')}>
              Decline
            </Button>
          </div>
        )}
      </div>
    </>
  )
  const look = cn('flex w-full gap-2.5 rounded-lg px-2 py-2.5', !notice.read && 'bg-primary/6', notice.read && 'text-muted-foreground')
  if (!open) return <div className={look}>{body}</div>
  return (
    <button
      type="button"
      className={cn(look, 'hover:bg-muted')}
      onClick={() => {
        onDone?.()
        reveal({ kind: 'task', id: notice.task!, title: notice.taskTitle ?? '', detail: '', done: false })
      }}
    >
      {body}
    </button>
  )
}

function NoticeList({ onDone }: { onDone?: () => void }) {
  const { team } = useApp()
  const notices = sortNotices(team?.notifications ?? [])
  if (notices.length === 0)
    return <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing new. Invites and tasks people give you show up here.</p>
  return (
    <div className="flex flex-col gap-0.5">
      {notices.map((n) => (
        <NoticeRow key={n.id} notice={n} onDone={onDone} />
      ))}
    </div>
  )
}

// A row at the bottom of the sidebar, with a count while anything is unread.
export function Bell() {
  const { team } = useApp()
  const [open, setOpen] = useState(false)
  if (!team) return null
  const count = unread(team)
  return (
    <SidebarMenuItem>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) markRead(count)
        }}
      >
        <PopoverTrigger asChild>
          <SidebarMenuButton className="max-md:h-11 max-md:text-base" aria-label={count ? `Notifications, ${count} new` : 'Notifications'}>
            <BellIcon className="!size-[15px] text-muted-foreground opacity-75" />
            <span>Notifications</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="max-h-[70vh] w-[22rem] overflow-y-auto p-2">
          <div className="flex items-baseline justify-between px-2 pt-1 pb-2">
            <h2 className="font-semibold">Notifications</h2>
          </div>
          <NoticeList onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {count > 0 && (
        <SidebarMenuBadge className="top-1.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground max-md:top-3">
          {count}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  )
}

// On a phone: the bell beside a screen's title, opening the list as a screen.
export function PhoneBell({ className }: { className?: string }) {
  const { team, openView } = useApp()
  if (!team) return null
  const count = unread(team)
  return (
    <button
      type="button"
      onClick={() => openView({ kind: 'notifications' })}
      aria-label={count ? `Notifications, ${count} new` : 'Notifications'}
      className={cn('relative flex size-9 items-center justify-center text-primary', className)}
    >
      <BellIcon className="size-[22px]" />
      {count > 0 && (
        <span className="absolute top-0.5 right-0 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground ring-2 ring-background">
          {count}
        </span>
      )}
    </button>
  )
}

// The list as a page of its own: the phone's, opened from the bell.
export function NotificationsScreen() {
  const { team } = useApp()
  const [count] = useState(() => unread(team))
  // Read once, when the screen opens: what was new stays marked while it is looked at.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => markRead(count), [])
  return (
    <div className="max-w-xl">
      <ViewHeader title="Notifications" />
      <div className="-mx-2">
        <NoticeList />
      </div>
    </div>
  )
}
