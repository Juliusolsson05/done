import { CalendarDaysIcon, CalendarIcon, InboxIcon, MenuIcon, PlusIcon, type LucideIcon } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'
import { useApp } from '@/lib/app-context'
import { TODAY } from '@/lib/days'
import { counts, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// The bar at the bottom of a phone's screen: the three lists used every day,
// adding a task, and the way to everything else. At the bottom because that
// is where a thumb is. A window has the sidebar and never shows this.
export function MobileBar() {
  const { data, ui, openView, add } = useApp()
  const { isMobile, setOpenMobile } = useSidebar()
  if (!isMobile) return null
  const count = counts(data.tasks, TODAY)

  const tab = (kind: Extract<View['kind'], 'inbox' | 'today' | 'upcoming'>, label: string, Icon: LucideIcon, badge: number, late = false) => {
    const current = ui.view.kind === kind
    return (
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={() => openView({ kind })}
        className={cn('flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem]', current ? 'font-medium text-primary' : 'text-muted-foreground')}
      >
        <span className="relative">
          <Icon className="size-6" strokeWidth={current ? 2.2 : 1.8} />
          {badge > 0 && (
            <span
              className={cn(
                'absolute -top-1.5 left-4 min-w-4 rounded-full px-1 text-center text-[0.625rem] leading-4 font-medium tabular-nums',
                late ? 'bg-overdue text-white' : 'bg-secondary text-secondary-foreground',
              )}
            >
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
      // Hidden while something is being typed: the keyboard is up, and the
      // bar would only take room from what is being written.
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-center border-t bg-background/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md select-none',
        (ui.adding || ui.editing !== null) && 'hidden',
      )}
    >
      {tab('inbox', 'Inbox', InboxIcon, count.inbox)}
      {tab('today', 'Today', CalendarIcon, count.today, count.late)}
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          aria-label="Add task"
          onClick={add}
          className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md active:scale-95"
        >
          <PlusIcon className="size-6" />
        </button>
      </div>
      {tab('upcoming', 'Upcoming', CalendarDaysIcon, count.upcoming)}
      <button type="button" onClick={() => setOpenMobile(true)} className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-muted-foreground">
        <MenuIcon className="size-6" strokeWidth={1.8} />
        Menu
      </button>
    </nav>
  )
}
