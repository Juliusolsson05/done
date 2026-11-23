// The parts of done that exist only on a phone, drawn the way iOS draws its
// own apps: a navigation bar with a large title that shrinks into the bar as
// the page scrolls, a tab bar, a Lists screen in place of a sidebar, and the
// swipe from the left edge that goes back. A window never shows any of this.
import { PhoneBell } from '@/components/notifications'
import { SpacePicker } from '@/components/space-picker'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarDaysIcon,
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  ColumnsIcon,
  EllipsisIcon,
  GanttChartIcon,
  InboxIcon,
  ListIcon,
  NotebookPenIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TimerIcon,
  type LucideIcon,
} from 'lucide-react'
import { useApp, colorStyle } from '@/lib/app-context'
import { TODAY } from '@/lib/days'
import { tick } from '@/lib/haptics'
import { colorIndex, counts, openTasks, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// The three lists that are tabs of their own. Everything else is reached from
// Lists, and shows a way back to it.
const TABS = ['today', 'inbox', 'upcoming', 'lists'] as const
export const isTab = (view: View) => (TABS as readonly string[]).includes(view.kind)

// The navigation bar and large title. The bar is always there, holding the
// way back; its background and its small title appear once the large title
// has scrolled up under it, as in Mail, Notes and Reminders.
export function PhoneHeader({ title, sub, children }: { title: ReactNode; sub?: string; children?: ReactNode }) {
  const { ui, openView, closeAll } = useApp()
  const bar = useRef<HTMLDivElement>(null)
  const big = useRef<HTMLHeadingElement>(null)
  // 0: at the top. 1: the page is under the bar. 2: the large title is gone.
  const [under, setUnder] = useState(0)
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const barBottom = bar.current?.getBoundingClientRect().bottom ?? 0
      const titleBottom = big.current?.getBoundingClientRect().bottom ?? Infinity
      setUnder(window.scrollY <= 0 ? 0 : titleBottom <= barBottom ? 2 : 1)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])
  const pushed = !isTab(ui.view)
  const menu = ui.view.kind === 'project' && children !== undefined
  const [actions, setActions] = useState(false)

  return (
    <>
      {/* Drawn outside the page: the page slides when it is pushed in or
          swiped back, and a fixed bar inside it would slide along. */}
      {createPortal(
        <div
          ref={bar}
          className={cn(
            'fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] transition-colors duration-200',
            under > 0 ? 'border-b border-border bg-background/80 backdrop-blur-xl backdrop-saturate-150' : 'border-b border-transparent',
          )}
        >
          <div className="relative flex h-11 items-center px-2">
            {pushed && (
              <button
                type="button"
                onClick={() => openView({ kind: 'lists' })}
                className="relative z-10 -ml-1 flex items-center text-body text-primary active:opacity-40"
              >
                <ChevronLeftIcon className="size-7" strokeWidth={2.4} />
                Lists
              </button>
            )}
            {menu && (
              <button
                type="button"
                aria-label="More"
                onClick={() => setActions(true)}
                className="relative z-10 ml-auto flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary active:opacity-40"
              >
                <EllipsisIcon className="size-5" strokeWidth={2.4} />
              </button>
            )}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-24 truncate text-center text-body font-semibold transition-opacity duration-200',
                under === 2 ? 'opacity-100' : 'opacity-0',
              )}
            >
              {title}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <header className="mb-2 flex flex-col">
        <h1 ref={big} className="flex items-center gap-2.5 text-large-title font-bold tracking-tight">
          {title}
        </h1>
        {sub && <span className="text-subhead text-tertiary">{sub}</span>}
        {children && !menu && <div className="-ml-2.5 flex flex-wrap gap-1 pt-1">{children}</div>}
        {/* A list's own actions (rename, delete) are behind ⋯ in the bar and
            come up as an action sheet, as iOS does. Tapping one closes it. */}
        {menu &&
          (actions || ui.confirmDelete) &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex flex-col justify-end gap-2 bg-black/40 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
              onClick={() => {
                // Asking to delete keeps the sheet up, now asking to confirm.
                setActions(false)
              }}
            >
              <div className="flex animate-rise flex-col overflow-hidden rounded-2xl bg-background/90 backdrop-blur-xl [&>button]:h-14 [&>button]:w-full [&>button]:justify-center [&>button]:rounded-none [&>button]:border-b [&>button]:border-border [&>button]:text-title [&>button]:font-normal [&>button]:text-primary [&>button:last-child]:border-b-0 [&>button.text-destructive]:text-destructive">
                {children}
              </div>
              <button type="button" onClick={closeAll} className="h-14 animate-rise rounded-2xl bg-background text-title font-semibold text-primary">
                Cancel
              </button>
            </div>,
            document.body,
          )}
      </header>
    </>
  )
}

// The tab bar: the three lists used every day, and Lists for the rest.
export function TabBar() {
  const { shown, keep, ui, openView } = useApp()
  // Red, like any badge on iOS, so only for what is overdue.
  const late = openTasks(shown.tasks).filter((t) => keep(t) && t.due !== null && t.due < TODAY).length
  const current = isTab(ui.view) ? ui.view.kind : 'lists'
  // Out of the way while something is being written: the keyboard is up.
  if (ui.adding || ui.editing !== null) return null

  const tab = (kind: (typeof TABS)[number], label: string, Icon: LucideIcon, badge = 0) => {
    const chosen = current === kind
    return (
      <button
        key={kind}
        type="button"
        aria-current={chosen ? 'page' : undefined}
        onClick={() => {
          if (!chosen) tick()
          openView({ kind })
          // Tapping the tab you are on goes back to the top, as on iOS.
          if (chosen) window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        className={cn('flex flex-1 flex-col items-center gap-0.5 pt-1.5 text-tab font-medium', chosen ? 'text-primary' : 'text-tertiary')}
      >
        <span className="relative">
          <Icon className="size-6.5" strokeWidth={chosen ? 2.2 : 1.8} />
          {badge > 0 && (
            <span className="absolute -top-1 -right-2.5 min-w-4.5 rounded-full bg-overdue px-1 text-center text-caption leading-4.5 font-medium text-white tabular-nums">
              {badge}
            </span>
          )}
        </span>
        {label}
      </button>
    )
  }

  return (
    <nav
      aria-label="Views"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.0625rem+env(safe-area-inset-bottom))] items-start border-t border-border bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150"
    >
      {tab('today', 'Today', CalendarIcon, late)}
      {tab('inbox', 'Inbox', InboxIcon)}
      {tab('upcoming', 'Upcoming', CalendarDaysIcon)}
      {tab('lists', 'Lists', ListIcon)}
    </nav>
  )
}

// "New Task" at the bottom left, above the tab bar, where Reminders has its
// "New Reminder": in reach of a thumb, and only where a task can be added.
export function NewTaskButton() {
  const { ui, add } = useApp()
  const kind = ui.view.kind
  if (ui.adding || ui.editing !== null) return null
  if (kind !== 'today' && kind !== 'inbox' && kind !== 'upcoming' && kind !== 'project') return null
  return (
    <button
      type="button"
      onClick={add}
      className="fixed bottom-[calc(3.0625rem+env(safe-area-inset-bottom)+0.5rem)] left-3 z-30 flex items-center gap-2 rounded-full bg-background/80 py-2 pr-4 pl-2 text-body font-semibold text-primary backdrop-blur-xl active:opacity-40"
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <PlusIcon className="size-4.5" strokeWidth={3} />
      </span>
      New Task
    </button>
  )
}

// A rounded white group on the grey ground, as in Settings and Reminders.
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-xl bg-background', className)}>{children}</div>
}

// One row of a group: an icon in a coloured circle, a name, a count, and the
// chevron that says it opens something. Separated by a hairline that starts
// where the text starts.
function GroupRow({ icon, name, count, onClick, color }: { icon: ReactNode; name: string; count?: number; onClick: () => void; color?: string }) {
  return (
    <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 pl-4 text-left active:bg-secondary">
      <span className={cn('flex size-7.5 shrink-0 items-center justify-center rounded-full text-white', color ?? 'bg-project')}>{icon}</span>
      <span className="flex min-h-11 min-w-0 flex-1 items-center gap-2 border-b border-border py-2.5 pr-4 group-last:border-b-0">
        <span className="min-w-0 flex-1 truncate text-body">{name}</span>
        {count !== undefined && <span className="text-body text-tertiary tabular-nums">{count}</span>}
        <ChevronRightIcon className="size-4.5 text-faint" strokeWidth={2.4} />
      </span>
    </button>
  )
}

// One of the four cards at the top of Lists, as Reminders shows Today,
// Scheduled, All and Flagged.
function Card({ icon: Icon, name, count, color, onClick }: { icon: LucideIcon; name: string; count?: number; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col gap-2 rounded-xl bg-background p-3 text-left active:opacity-70">
      <span className="flex items-start justify-between">
        <span className={cn('flex size-8 items-center justify-center rounded-full text-white', color)}>
          <Icon className="size-4.5" strokeWidth={2.4} />
        </span>
        {count !== undefined && <span className="text-large-title leading-none font-bold tabular-nums">{count}</span>}
      </span>
      <span className="text-subhead font-semibold text-tertiary">{name}</span>
    </button>
  )
}

// Everything that is not a tab: the lists, the projects and the other views.
export function ListsScreen() {
  const { shown, keep, openView, search, newProject } = useApp()
  const count = counts(shown.tasks, TODAY, keep)
  const go = (view: View) => {
    tick()
    openView(view)
  }
  const more: [View['kind'], string, LucideIcon, string][] = [
    ['notes', 'Notes', NotebookPenIcon, 'bg-project-6'],
    ['board', 'Board', ColumnsIcon, 'bg-project-5'],
    ['timeline', 'Timeline', GanttChartIcon, 'bg-project-2'],
    ['focus', 'Focus', TimerIcon, 'bg-project-4'],
    ['timesheet', 'Time sheet', ClockIcon, 'bg-project-1'],
    ['settings', 'Settings', SettingsIcon, 'bg-tertiary'],
  ]
  return (
    <div className="flex flex-col gap-6 pb-4">
      <header className="flex flex-col gap-3 pt-2">
        <div className="flex items-center justify-between">
          <h1 className="text-large-title font-bold tracking-tight">Lists</h1>
          <PhoneBell />
        </div>
        {/* Where you are, as the sidebar's picker says in a window. */}
        <SpacePicker phone />
        <button type="button" onClick={search} className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground/6 px-2 text-body text-tertiary">
          <SearchIcon className="size-4.5" />
          Search
        </button>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Card icon={CalendarIcon} name="Today" count={count.today} color="bg-primary" onClick={() => go({ kind: 'today' })} />
        <Card icon={CalendarDaysIcon} name="Upcoming" count={count.upcoming} color="bg-overdue" onClick={() => go({ kind: 'upcoming' })} />
        <Card icon={InboxIcon} name="Inbox" count={count.inbox} color="bg-tertiary" onClick={() => go({ kind: 'inbox' })} />
        <Card icon={CheckIcon} name="Completed" color="bg-foreground/70" onClick={() => go({ kind: 'completed' })} />
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-title font-bold">My Lists</h2>
        <Group>
          {shown.projects.map((p) => (
            <div key={p.id} style={colorStyle(colorIndex(shown.projects, p.id))} className="contents">
              <GroupRow
                icon={<ListIcon className="size-4" strokeWidth={2.6} />}
                name={p.name}
                count={count.project(p.id)}
                onClick={() => go({ kind: 'project', id: p.id })}
              />
            </div>
          ))}
          {shown.projects.length === 0 && <p className="px-4 py-3 text-subhead text-tertiary">No lists yet.</p>}
        </Group>
        <button type="button" onClick={newProject} className="self-end px-1 text-body text-primary active:opacity-40">
          Add List
        </button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-title font-bold">More</h2>
        <Group>
          {more.map(([kind, name, Icon, color]) => (
            <GroupRow
              key={kind}
              icon={<Icon className="size-4" strokeWidth={2.4} />}
              name={name}
              color={color}
              onClick={() => go({ kind } as View)}
            />
          ))}
        </Group>
      </section>
      <p className="flex items-center justify-center gap-1.5 text-footnote text-tertiary">
        <CircleCheckIcon className="size-3.5" />
        {count.today === 0 ? 'Nothing left for today' : `${count.today} left for today`}
      </p>
    </div>
  )
}

// Back to Lists with a swipe from the left edge of the screen, as anywhere in
// iOS. The page follows the finger; letting go past a third of the width, or
// with a flick, goes back.
export function useEdgeSwipeBack(active: boolean, back: () => void, page: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return
    let start: { x: number; y: number; t: number } | null = null
    let dx = 0
    let decided: 'back' | 'no' | null = null
    const el = () => page.current
    const down = (e: TouchEvent) => {
      const t = e.touches[0]
      if (e.touches.length !== 1 || t.clientX > 24) return
      start = { x: t.clientX, y: t.clientY, t: Date.now() }
      dx = 0
      decided = null
    }
    const move = (e: TouchEvent) => {
      if (!start) return
      const t = e.touches[0]
      dx = Math.max(0, t.clientX - start.x)
      const dy = Math.abs(t.clientY - start.y)
      if (!decided) decided = dx > 10 && dx > dy ? 'back' : dy > 10 ? 'no' : null
      if (decided !== 'back') return
      e.preventDefault()
      const node = el()
      if (node) {
        node.style.transition = 'none'
        node.style.transform = `translateX(${dx}px)`
      }
    }
    const up = () => {
      if (!start) return
      const fast = dx / Math.max(1, Date.now() - start.t) > 0.5
      const node = el()
      const going = decided === 'back' && (dx > window.innerWidth / 3 || (fast && dx > 40))
      if (node && decided === 'back') {
        node.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.25, 1)'
        node.style.transform = going ? `translateX(${window.innerWidth}px)` : ''
        if (going) {
          setTimeout(() => {
            node.style.transition = ''
            node.style.transform = ''
            back()
          }, 200)
        }
      }
      start = null
    }
    document.addEventListener('touchstart', down, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', up)
    document.addEventListener('touchcancel', up)
    return () => {
      document.removeEventListener('touchstart', down)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
      document.removeEventListener('touchcancel', up)
    }
  }, [active, back, page])
}
