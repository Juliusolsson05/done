import type { ReactNode } from 'react'
import { CalendarDaysIcon, CalendarIcon, ChartGanttIcon, Columns3Icon, InboxIcon, PlusIcon, SlidersHorizontalIcon, TimerIcon, type LucideIcon } from 'lucide-react'
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
  const { data, info, ui, focus, openView, newProject } = useApp()
  const count = counts(data.tasks, TODAY)

  // `badge` is a count, left out at zero, or for Focus the time left.
  const nav = (kind: BuiltIn, label: string, Icon: LucideIcon, badge: ReactNode = 0, late = false) => (
    <SidebarMenuItem>
      <SidebarMenuButton data-view={kind} isActive={ui.view.kind === kind} onClick={() => openView({ kind })}>
        <Icon className="text-muted-foreground" />
        <span>{label}</span>
      </SidebarMenuButton>
      {badge ? <SidebarMenuBadge className={cn('font-normal', late ? 'text-overdue' : 'text-faint')}>{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible="none" className="select-none max-md:h-auto max-md:w-full">
      <SidebarHeader className="px-4 pt-4 pb-1 text-base font-semibold tracking-tight">done</SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav('inbox', 'Inbox', InboxIcon, count.inbox)}
            {nav('today', 'Today', CalendarIcon, count.today, count.late)}
            {nav('upcoming', 'Upcoming', CalendarDaysIcon, count.upcoming)}
            {nav('timeline', 'Timeline', ChartGanttIcon)}
            {nav('board', 'Board', Columns3Icon)}
            {nav('focus', 'Focus', TimerIcon, focus && <Countdown session={focus} />)}
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
                >
                  <ProjectDot id={project.id} className="mx-1" />
                  <span>{project.name}</span>
                </SidebarMenuButton>
                {count.project(project.id) > 0 && <SidebarMenuBadge className="font-normal text-faint">{count.project(project.id)}</SidebarMenuBadge>}
              </SidebarMenuItem>
            ))}
            {ui.newProject && <NewProject />}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
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
