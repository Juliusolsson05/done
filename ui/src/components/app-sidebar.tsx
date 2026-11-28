import { shortcut } from '@/lib/platform'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  CalendarDaysIcon,
  CircleCheckIcon,
  CalendarIcon,
  ChartGanttIcon,
  ClipboardListIcon,
  Columns3Icon,
  FolderIcon,
  FolderPlusIcon,
  InboxIcon,
  PlusIcon,
  NotebookPenIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TimerIcon,
  UserCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { Bell } from '@/components/notifications'
import { SpaceMark, SpacePicker } from '@/components/space-picker'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Countdown } from '@/components/focus-view'
import { NameField } from '@/components/note-folders'
import { ProjectDot } from '@/components/marks'
import { useFocus, useNameField } from '@/hooks/use-focus'
import { useSidebarDocked } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { restart } from '@/lib/backend'
import { play } from '@/lib/sounds'
import { TODAY } from '@/lib/days'
import { addProject, counts, openTasks, type Project, type View } from '@/lib/tasks'
import { isPersonal, workspaces } from '@/lib/team'
import { getFolderPanel, getNamingFolder, nameFolder, NEW_FOLDER, subscribeFolderPanel } from '@/lib/note-folder-panel'
import { sameFolder } from '@/lib/notes'
import { cn } from '@/lib/utils'

type BuiltIn = Exclude<View['kind'], 'project'>

// Under a finger (a phone, an iPad) a row is tall enough to hit with a thumb.
// A row with a count beside it keeps room for the count, so a long name is
// cut short before it, never under it.
const ROW = 'group-has-data-[sidebar=menu-badge]/menu-item:pr-8 touch:h-11 touch:pr-9 touch:text-base'
// The count sits in the middle of the taller row.
const BADGE = 'touch:top-3 touch:text-sm'

// `space`: the workspace the new project is made in; null for your own.
function NewProject({ space }: { space: number | null }) {
  const { data, update, openView, closeAll } = useApp()
  const inputRef = useFocus()
  const field = useNameField((value) => {
    const name = value.trim()
    if (!name) return closeAll()
    const id = data.nextId
    play('add')
    update((d) => addProject(d, name, space))
    openView({ kind: 'project', id })
  })
  return (
    <SidebarMenuItem>
      <SidebarInput ref={inputRef} placeholder="Project name" aria-label="Project name" {...field} />
    </SidebarMenuItem>
  )
}

// The note folders, under Notes while the Notes page is open: the sidebar
// says where you are, the list beside it what is there, and the right the
// note itself. Right-click a folder to rename or delete it.
function NoteFolders() {
  const panel = useSyncExternalStore(subscribeFolderPanel, getFolderPanel)
  const naming = useSyncExternalStore(subscribeFolderPanel, getNamingFolder)
  if (!panel) return null
  const row = (folder: string | null, name: string, count: number) => {
    const active = folder === null ? panel.selected === null : panel.selected !== null && sameFolder(panel.selected, folder)
    if (folder !== null && naming !== null && sameFolder(naming, folder))
      return (
        <SidebarMenuSubItem key={name}>
          <NameField
            initial={folder}
            label="Folder name"
            onDone={(to) => {
              nameFolder(null)
              if (to !== null) panel.rename(folder, to)
            }}
          />
        </SidebarMenuSubItem>
      )
    return (
      <SidebarMenuSubItem key={name}>
        <SidebarMenuSubButton asChild isActive={active}>
          <button type="button" data-note-folder={folder ?? ''} onClick={() => panel.select(folder)} className="w-full">
            <FolderIcon className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{name}</span>
            <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">{count}</span>
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    )
  }
  return (
    <SidebarMenuSub aria-label="Note folders">
      {row(null, 'All notes', panel.total)}
      {panel.folders.map((f) => row(f.name, f.name, f.count))}
      <SidebarMenuSubItem>
        {naming === NEW_FOLDER ? (
          <NameField
            initial=""
            label="New folder name"
            onDone={(name) => {
              nameFolder(null)
              if (name !== null) panel.create(name)
            }}
          />
        ) : (
          <SidebarMenuSubButton asChild>
            <button type="button" onClick={() => nameFolder(NEW_FOLDER)} className="w-full text-muted-foreground">
              <FolderPlusIcon className="text-muted-foreground" />
              <span>New folder</span>
            </button>
          </SidebarMenuSubButton>
        )}
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  )
}

// An iPad held upright has no room for the sidebar beside the page, so there
// it is put away, as Mail and Notes put theirs away, and the button at the
// page's top left brings it back (App.tsx). Choosing a view puts it away
// again. Turned sideways, it comes back as it was. Being put away like this
// is not remembered: the sidebar's cookie keeps what was last chosen by hand,
// for the next time there is room. On a Mac and a phone this does nothing.
const chosenOpen = () => !document.cookie.split('; ').includes('sidebar_state=false')

function useSidebarMakesRoom(view: View) {
  const docked = useSidebarDocked()
  const { open, setOpen } = useSidebar()
  const was = useRef(docked)
  const seenView = useRef(view)
  const automatically = (next: boolean) => {
    if (next === open) return
    const chosen = chosenOpen()
    setOpen(next)
    // setOpen wrote the cookie; put back what was chosen by hand.
    document.cookie = `sidebar_state=${chosen}; path=/; max-age=${60 * 60 * 24 * 7}`
  }
  // Once, before the first paint, so it is never seen open and then closing.
  useLayoutEffect(() => {
    if (!docked) automatically(false)
  }, [])
  useEffect(() => {
    if (was.current === docked) return
    was.current = docked
    automatically(docked && chosenOpen())
  }, [docked])
  useEffect(() => {
    if (seenView.current === view) return
    seenView.current = view
    if (!docked) automatically(false)
  }, [view])
}

export function AppSidebar() {
  const { info, ui, focus, openView: open, newProject, search, shown, keep, team, me, scope } = useApp()
  useSidebarMakesRoom(ui.view)
  const { setOpenMobile } = useSidebar()
  const count = counts(shown.tasks, TODAY, keep)
  const spaces = workspaces(team)
  const mine = me ? openTasks(shown.tasks).filter((t) => (t.assignees ?? []).includes(me)).length : 0
  // Where "+" makes a project: the group it is on.
  const [newIn, setNewIn] = useState<number | null>(null)
  const startProject = (space: number | null) => {
    setNewIn(space)
    newProject()
  }
  // On a phone the sidebar lies over the page, so choosing a view puts it away.
  const openView = (view: View) => {
    setOpenMobile(false)
    open(view)
  }

  // `badge` is a count, left out at zero, or for Focus the time left.
  const nav = (kind: BuiltIn, label: string, Icon: LucideIcon, badge: ReactNode = 0, late = false) => (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-view={kind}
        isActive={ui.view.kind === kind}
        onClick={() => openView({ kind })}
        // Where you are: a faint wash of done's blue, not a grey block.
        className={cn(ROW, 'data-active:bg-primary/10 data-active:text-foreground')}
      >
        {/* Small and quiet: the names do the work; icons only help the eye find its place. */}
        <Icon className={cn('!size-[15px]', ui.view.kind === kind ? 'text-primary' : 'text-muted-foreground opacity-75')} />
        <span>{label}</span>
      </SidebarMenuButton>
      {badge ? <SidebarMenuBadge className={cn('font-normal', BADGE, late ? 'text-overdue' : 'text-faint')}>{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )

  // A render function, not a component: a component made here would be new
  // on every render, and a project name being typed in it would be lost.
  const projectGroup = (key: string, label: string, projects: Project[], space: number | null, mark?: ReactNode) => (
      <SidebarGroup key={key}>
        <SidebarGroupLabel className="gap-1.5 text-faint">
          {mark}
          {label}
        </SidebarGroupLabel>
        <SidebarGroupAction aria-label={`New project in ${label}`} title="New project" onClick={() => startProject(space)}>
          <PlusIcon />
        </SidebarGroupAction>
        <SidebarMenu>
          {projects.map((project) => (
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
          {ui.newProject && newIn === space && <NewProject space={space} />}
        </SidebarMenu>
      </SidebarGroup>
  )

  return (
    // On a phone the sidebar is a sheet that slides in over the page (opened
    // from the bar at the bottom); in a window it can be put away with the
    // button at the page's top left, or Cmd+B.
    <Sidebar collapsible="offcanvas" className="select-none">
      <SidebarHeader className="flex-row items-center justify-between px-4 pt-4 pb-1 text-base font-semibold tracking-tight max-md:pt-[calc(var(--safe-top)+1rem)]">
        {/* The wordmark: done's round check, ticked, as on the app icon, in the
            colour of done, beside the name in the display face. */}
        <span className="flex items-center gap-2 font-display text-[19px] font-semibold tracking-[-0.02em]">
          <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[18px] shrink-0">
            <circle cx="10" cy="10" r="10" fill="var(--primary)" />
            <path d="M5.6 10.3l3 3 5.8-6.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          done
        </span>
        <SidebarTrigger className="-mr-2 text-muted-foreground max-md:hidden" title={`Hide sidebar (${shortcut('B')})`} />
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
              {/* A shortcut hint is for a keyboard; a finger has none to press. */}
              <SidebarMenuBadge className={cn('font-normal text-faint touch:hidden', BADGE)}>{shortcut('K')}</SidebarMenuBadge>
            </SidebarMenuItem>
            {/* The Inbox is your own. In a workspace it shows only what lost its project there. */}
            {(typeof scope !== 'number' || count.inbox > 0) && nav('inbox', 'Inbox', InboxIcon, count.inbox)}
            {nav('today', 'Today', CalendarIcon, count.today, count.late)}
            {nav('upcoming', 'Upcoming', CalendarDaysIcon, count.upcoming)}
            {spaces.length > 0 && scope !== 'personal' && nav('mine', 'Assigned to me', UserCheckIcon, mine)}
            {nav('timeline', 'Timeline', ChartGanttIcon)}
            {nav('board', 'Board', Columns3Icon)}
            {nav('notes', 'Notes', NotebookPenIcon)}
            {ui.view.kind === 'notes' && <NoteFolders />}
          </SidebarMenu>
        </SidebarGroup>
        {/* In All with workspaces, the projects are grouped by where they
            live: your own first, then each workspace. Elsewhere, one list. */}
        {scope === 'all' && spaces.length > 0 ? (
          <>
            {projectGroup('own', 'Your projects', shown.projects.filter((p) => isPersonal(p.spaceId, team)), null)}
            {spaces.map((w) =>
              projectGroup(String(w.id), w.name, shown.projects.filter((p) => p.spaceId === w.id), w.id, <SpaceMark space={w} className="size-3.5 rounded-[3px] text-[8px]" />),
            )}
          </>
        ) : (
          projectGroup('projects', 'Projects', shown.projects, typeof scope === 'number' ? scope : null)
        )}
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
      <SidebarFooter className="max-md:pb-[calc(var(--safe-bottom)+0.5rem)]">
        <SidebarMenu>
          {info.updateReady && (
            <SidebarMenuItem>
              <SidebarMenuButton className="font-medium text-primary hover:text-primary" onClick={restart}>
                <span>Restart to update</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <Bell />
          {nav('settings', 'Settings', SlidersHorizontalIcon)}
        </SidebarMenu>
        <SpacePicker />
      </SidebarFooter>
    </Sidebar>
  )
}
