import type { ReactNode } from 'react'
import {
  CalendarDaysIcon,
  CircleCheckIcon,
  CalendarIcon,
  ChartGanttIcon,
  ClipboardListIcon,
  Columns3Icon,
  InboxIcon,
  PlusIcon,
  NotebookPenIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TimerIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Countdown } from '@/components/focus-view'
import { ProjectDot } from '@/components/marks'
import { useFocus, useNameField } from '@/hooks/use-focus'
import { useApp } from '@/lib/app-context'
import { restart } from '@/lib/backend'
import { play } from '@/lib/sounds'
import { TODAY } from '@/lib/days'
import { addProject, counts, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'

type BuiltIn = Exclude<View['kind'], 'project'>

// On a phone a row is tall enough to hit with a thumb.
// A row with a count beside it keeps room for the count, so a long name is
// cut short before it, never under it.
const ROW = 'group-has-data-[sidebar=menu-badge]/menu-item:pr-8 max-md:h-11 max-md:pr-9 max-md:text-base'
// The count sits in the middle of the taller row.
const BADGE = 'max-md:top-3 max-md:text-sm'

function NewProject() {
  const { data, update, openView, closeAll } = useApp()
  const inputRef = useFocus()
  const field = useNameField((value) => {
    const name = value.trim()
    if (!name) return closeAll()
    const id = data.nextId
    play('add')
    update((d) => addProject(d, name))
    openView({ kind: 'project', id })
  })
  return (
    <SidebarMenuItem>
      <SidebarInput ref={inputRef} placeholder="Project name" aria-label="Project name" {...field} />
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { data, info, ui, focus, openView: open, newProject, search } = useApp()
  const { setOpenMobile } = useSidebar()
  const count = counts(data.tasks, TODAY)
  // On a phone the sidebar lies over the page, so choosing a view puts it away.
  const openView = (view: View) => {
    setOpenMobile(false)
    open(view)
  }

  // `badge` is a count, left out at zero, or for Focus the time left.
  const nav = (kind: BuiltIn, label: string, Icon: LucideIcon, badge: ReactNode = 0, late = false) => (
    <SidebarMenuItem>
      <SidebarMenuButton data-view={kind} isActive={ui.view.kind === kind} onClick={() => openView({ kind })} className={ROW}>
        <Icon className="text-muted-foreground" />
        <span>{label}</span>
      </SidebarMenuButton>
      {badge ? <SidebarMenuBadge className={cn('font-normal', BADGE, late ? 'text-overdue' : 'text-faint')}>{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )

  return (
    // On a phone the sidebar is a sheet that slides in over the page (opened
    // from the bar at the bottom); in a window it can be put away with the
    // button at the page's top left, or Cmd+B.
    <Sidebar collapsible="offcanvas" className="select-none">
      <SidebarHeader className="flex-row items-center justify-between px-4 pt-4 pb-1 text-base font-semibold tracking-tight max-md:pt-[calc(env(safe-area-inset-top)+1rem)]">
        done
        <SidebarTrigger className="-mr-2 text-muted-foreground max-md:hidden" title="Hide sidebar (⌘B)" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  setOpenMobile(false)
                  search()
                }}
                className={ROW}
              >
                <SearchIcon className="text-muted-foreground" />
                <span>Search</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className={cn('font-normal text-faint max-md:hidden', BADGE)}>⌘K</SidebarMenuBadge>
            </SidebarMenuItem>
            {nav('inbox', 'Inbox', InboxIcon, count.inbox)}
            {nav('today', 'Today', CalendarIcon, count.today, count.late)}
            {nav('upcoming', 'Upcoming', CalendarDaysIcon, count.upcoming)}
            {nav('timeline', 'Timeline', ChartGanttIcon)}
            {nav('board', 'Board', Columns3Icon)}
            {nav('notes', 'Notes', NotebookPenIcon)}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-faint">Projects</SidebarGroupLabel>
          <SidebarGroupAction aria-label="New project" title="New project" onClick={newProject}>
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarMenu>
            {data.projects.map((project) => (
              <SidebarMenuItem key={project.id}>
                <SidebarMenuButton
                  data-project={project.id}
                  isActive={ui.view.kind === 'project' && ui.view.id === project.id}
                  onClick={() => openView({ kind: 'project', id: project.id })}
                  className={ROW}
                >
                  <ProjectDot id={project.id} className="mx-1" />
                  <span>{project.name}</span>
                </SidebarMenuButton>
                {count.project(project.id) > 0 && <SidebarMenuBadge className={cn('font-normal text-faint', BADGE)}>{count.project(project.id)}</SidebarMenuBadge>}
              </SidebarMenuItem>
            ))}
            {ui.newProject && <NewProject />}
          </SidebarMenu>
        </SidebarGroup>
        {/* Less used, so below the projects: focusing, the record of it, and what is done. */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-faint">Extras</SidebarGroupLabel>
          <SidebarMenu>
            {nav('focus', 'Focus', TimerIcon, focus && <Countdown session={focus} />)}
            {nav('timesheet', 'Time sheet', ClipboardListIcon)}
            {nav('completed', 'Completed', CircleCheckIcon)}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="max-md:pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <SidebarMenu>
          {info.updateReady && (
            <SidebarMenuItem>
              <SidebarMenuButton className="font-medium text-primary hover:text-primary" onClick={restart}>
                <span>Restart to update</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {nav('settings', 'Settings', SlidersHorizontalIcon)}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
