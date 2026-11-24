import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AppMenu, menuTargetOf, type MenuTarget } from '@/components/app-menu'
import { AppSidebar } from '@/components/app-sidebar'
import { Board } from '@/components/board'
import { Completed } from '@/components/completed'
import { FocusView } from '@/components/focus-view'
import { ListView } from '@/components/list-view'
import { isTab, ListsScreen, NewTaskButton, TabBar, useEdgeSwipeBack } from '@/components/phone'
import { MobileQuickAdd } from '@/components/quick-add'
import { MoveProjectDialog } from '@/components/move-project'
import { NotificationsScreen } from '@/components/notifications'
import { Notes } from '@/components/notes'
import { Settings } from '@/components/settings'
import { TaskEditorDialog, TaskSheet } from '@/components/task-editor'
import { FindBar } from '@/components/find-bar'
import { SearchDialog } from '@/components/search'
import { TimeSheet } from '@/components/time-sheet'
import { Timeline } from '@/components/timeline'
import { AppContext, type App as AppValue, type Ui } from '@/lib/app-context'
import { isDesktop, onMenuBarCommand, setWebviewZoom } from '@/lib/backend'
import { addDays, dayOf, TODAY } from '@/lib/days'
import { useIsMobile } from '@/hooks/use-mobile'
import { DEFAULT_MINUTES, isDue } from '@/lib/focus'
import { endFocus, getFocus, handOff, onRecordFailed, remind, retryUnsaved, subscribeFocus, timeIsUp, toggleFocus } from '@/lib/focus-store'
import { play } from '@/lib/sounds'
import { caughtUp, change, getSnapshot, load, onLost, refresh, replicateNow, subscribe } from '@/lib/store'
import { setScope, useScope } from '@/lib/scope-store'
import { forMe, shownFor, validScope } from '@/lib/team'
import { forgetLast, undoLast } from '@/lib/undo'
import { deleteProject, deleteTask, finishesBig, markDone, markOpen, type Data, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { setFilterOpen } from '@/lib/view-filter-store'
import { back, opened } from '@/lib/view-history'

const CLOSED = { adding: false, asGoal: false, editing: null, newProject: false, renaming: false, confirmDelete: false, searching: false }
const isOpen = (ui: Ui) => ui.adding || ui.editing !== null || ui.newProject || ui.renaming || ui.confirmDelete || ui.searching

// Whether the sidebar was showing when the app was last open. The sidebar
// writes this cookie itself each time it is put away or brought back.
function sidebarWasOpen(): boolean {
  return !document.cookie.split('; ').includes('sidebar_state=false')
}

// Puts the sidebar away and brings it back; so does Cmd+B. Fixed to the
// page's top left corner, so it stays in reach however far a page is scrolled.
// With the sidebar put away, the button to bring it back sits inside the
// page's top left corner and stays there as the page scrolls. (While the
// sidebar shows, its own header has the button.)
function SidebarToggle() {
  const { open, isMobile } = useSidebar()
  if (open || isMobile) return null
  return (
    <div className="sticky top-0 z-20 h-0">
      {/* In the page's left margin, clear of the title it sits beside. */}
      <SidebarTrigger className="-mt-6 -ml-10 text-muted-foreground" title="Show sidebar (⌘B)" />
    </div>
  )
}

function storedZoom(): number {
  try {
    return Number(localStorage.getItem('done-zoom')) || 1
  } catch {
    return 1
  }
}

export default function App() {
  const { data, info } = useSyncExternalStore(subscribe, getSnapshot)
  const focus = useSyncExternalStore(subscribeFocus, getFocus)
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [ui, setUi] = useState<Ui>(() => ({
    ...CLOSED,
    // A reminder that was showing before a reload is still showing after it.
    view: { kind: getFocus()?.reminding ? 'focus' : 'today' },
    history: [],
    tlStart: addDays(TODAY, -4),
    focusPick: null,
    focusMinutes: DEFAULT_MINUTES,
  }))
  const [noticed, setNoticed] = useState<number | null>(null)
  const [zoom, setZoomState] = useState(storedZoom)
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({ kind: 'space' })
  const dragging = useRef(false)
  const menuOpen = useRef(false)
  const isMobile = useIsMobile()
  const team = data.team ?? null
  const me = team?.me ?? null
  const scope = validScope(useScope(), team)
  const shown = shownFor(data, scope, team)

  const closeAll = () => setUi((u) => ({ ...u, ...CLOSED }))
  // The page a phone swipes back from.
  const page = useRef<HTMLDivElement>(null)
  const goBack = useCallback(() => latest.current.back(), [])
  useEdgeSwipeBack(isMobile && !isTab(ui.view) && !isOpen(ui), goBack, page)

  // One message at a time, like one thing said at a time: a new one takes
  // the place of the last, and takes its Undo with it.
  const say = (text: string, undo?: (data: Data) => Data) => {
    const onUndo = () => {
      if (!undo) return
      play('undo')
      // The same step Cmd+Z would undo; it is done here instead.
      forgetLast()
      change(undo, false)
    }
    toast(text, { id: 'said', duration: 5000, action: undo ? { label: 'Undo', onClick: onUndo } : undefined })
  }

  const notice = (id: number) => {
    setNoticed(id)
    setTimeout(() => setNoticed((now) => (now === id ? null : now)), 1000)
  }

  const setZoom = (next: number) => {
    const value = Math.min(2, Math.max(0.7, Math.round(next * 10) / 10))
    setZoomState(value)
    try {
      localStorage.setItem('done-zoom', String(value))
    } catch {
      // Private windows may refuse storage; the size still applies for now.
    }
    setWebviewZoom(value)
  }

  const app: AppValue = {
    data,
    info,
    team,
    me,
    scope,
    shown,
    setScope: (next) => {
      setScope(next)
      // A project of another space is not on the page any more.
      setUi((u) => ({ ...u, ...CLOSED, view: u.view.kind === 'project' || (u.view.kind === 'inbox' && typeof next === 'number') ? { kind: 'today' } : u.view }))
    },
    keep: (task) => scope !== 'all' || forMe(task, me),
    async teamAct(run, said) {
      try {
        await run()
        await caughtUp()
        if (said) say(said)
        return true
      } catch (error) {
        play('error')
        say(error instanceof Error && error.message !== 'failed' ? error.message : 'That did not work. Check the connection and try again.')
        return false
      }
    },
    ui,
    zoom,
    focus,
    noticed,
    dragging,
    closeAll,
    say,
    setZoom,
    openView: (view: View) => setUi((u) => ({ ...u, ...CLOSED, view, history: opened(u.history, u.view, view, isTab(view)) })),
    back: () =>
      setUi((u) => {
        // A list that is gone, or is not in this space, is skipped.
        const to = back(u.history, (v) => v.kind !== 'project' || shown.projects.some((p) => p.id === v.id))
        return { ...u, ...CLOSED, view: to.view, history: to.history }
      }),
    // Settings, Focus, the time sheet and Notes have no list to add to, so adding from there goes to Inbox.
    add: () =>
      setUi((u) => ({
        ...u,
        ...CLOSED,
        view:
          u.view.kind === 'settings' || u.view.kind === 'focus' || u.view.kind === 'timesheet' || u.view.kind === 'completed' || u.view.kind === 'notes' || u.view.kind === 'lists' || u.view.kind === 'notifications'
            ? { kind: 'inbox' }
            : u.view,
        adding: true,
      })),
    addGoal: () => setUi((u) => ({ ...u, ...CLOSED, adding: true, asGoal: true })),
    edit: (id) => setUi((u) => ({ ...u, ...CLOSED, editing: id })),
    search: () => {
      play('open')
      setUi((u) => ({ ...u, ...CLOSED, searching: true }))
    },
    reveal(hit) {
      if (hit.kind === 'project') return app.openView({ kind: 'project', id: hit.id })
      if (hit.kind === 'note') return app.openView({ kind: 'notes', id: hit.id })
      // A subtask is edited from the task it is under, in that task's list.
      const found = data.tasks.find((t) => t.id === hit.id)
      const task = found?.parentId != null ? (data.tasks.find((t) => t.id === found.parentId) ?? found) : found
      if (!task) return closeAll()
      const view: View = task.projectId === null ? { kind: 'inbox' } : { kind: 'project', id: task.projectId }
      // Shown in its list, marked for a moment, and not opened for editing:
      // it can be ticked off, or clicked to edit, right there.
      // Already on the page you are looking at: stay there.
      const shown = document.querySelector(`[data-task="${task.id}"]`) !== null
      setUi((u) => (shown ? { ...u, ...CLOSED } : { ...u, ...CLOSED, view, history: opened(u.history, u.view, view, isTab(view)) }))
      notice(task.id)
      const bringIntoView = () =>
        (document.querySelector(`[data-task="${hit.id}"]`) ?? document.querySelector(`[data-task="${task.id}"]`))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      requestAnimationFrame(() => requestAnimationFrame(bringIntoView))
    },
    newProject: () => setUi((u) => ({ ...u, ...CLOSED, newProject: true })),
    rename: () => setUi((u) => ({ ...u, ...CLOSED, renaming: true })),
    askDelete: () => setUi((u) => ({ ...u, ...CLOSED, confirmDelete: true })),
    setTlStart: (tlStart) => setUi((u) => ({ ...u, tlStart })),
    focusOn: (id) => setUi((u) => ({ ...u, ...CLOSED, view: { kind: 'focus' }, focusPick: String(id) })),
    chooseFocus: (choice) => setUi((u) => ({ ...u, ...choice })),
    update(fn, id) {
      change(fn)
      if (id !== undefined) notice(id)
    },
    completeSound(id) {
      const task = data.tasks.find((t) => t.id === id)
      if (!task || task.done) return
      play(finishesBig(data.tasks, id, ui.view, TODAY) ? 'completeBig' : 'complete')
    },
    complete(id, heard = false) {
      if (data.tasks.find((t) => t.id === id)?.done) return
      if (!heard) app.completeSound(id)
      change((d) => markDone(d, id, TODAY))
      say('Task completed', (d) => markOpen(d, id))
    },
    reopen(id) {
      play('reopen')
      change((d) => markOpen(d, id))
      toast.dismiss('said')
    },
    removeTask(id) {
      const removed = deleteTask(data, id)
      play('delete')
      closeAll()
      change(() => removed.data)
      say('Task deleted', removed.undo)
    },
    removeProject(id) {
      const removed = deleteProject(data, id)
      play('delete')
      setUi((u) => ({ ...u, ...CLOSED, view: u.view.kind === 'project' && u.view.id === id ? { kind: 'inbox' } : u.view }))
      change(() => removed.data)
      say(removed.said, removed.undo)
    },
  }

  // The listeners below are set up once, so they read what is current
  // through this instead of what was current when they were set up.
  const latest = useRef(app)
  latest.current = app

  useEffect(() => {
    load().then(
      () => {
        const zoom = storedZoom()
        if (zoom !== 1) setWebviewZoom(zoom)
        // A session that was running before a reload: the menu bar is told again.
        handOff()
        retryUnsaved()
        setReady(true)
      },
      (error: unknown) => setFailed(String(error instanceof Error ? error.message : error)),
    )
    onLost((stale) => {
      // Only ever follows a save this window made, so it is the answer to
      // something the user did, not a background refresh.
      play('error')
      latest.current.closeAll()
      latest.current.say(stale ? 'Changed in another window. Showing the latest.' : 'That could not be saved. Showing what is stored.')
    })
    onRecordFailed(() => {
      play('error')
      latest.current.say('That focus block could not be written to the time sheet yet. It will be tried again.')
    })
  }, [])

  // Something is under your hands: typing, dragging or a menu open. Nothing
  // may change the page then. Reads only refs, so set-up-once listeners can call it.
  const busy = () => {
    const { ui } = latest.current
    return ui.adding || ui.editing !== null || ui.newProject || ui.renaming || ui.searching || dragging.current || menuOpen.current
  }

  // Keeping in step. An agent, another window or the web app may change the
  // tasks, and an update may have arrived. Checked when the window comes back
  // and every few seconds while it is in view, but never under your hands:
  // not while typing, dragging or with a menu open.
  useEffect(() => {
    const keepInStep = () => {
      if (dayOf(new Date()) !== TODAY) return location.reload()
      if (document.hidden || busy()) return
      refresh()
    }
    window.addEventListener('focus', keepInStep)
    const timer = setInterval(keepInStep, 4000)
    // A signed-in app swaps changes with its account: when it opens, when it
    // comes back, when the connection does, and every 15 seconds in view.
    // Never under your hands, for the same reason as above. Edits also go up
    // by themselves shortly after they are saved (store.ts).
    const swap = () => {
      if (document.hidden || busy()) return
      void replicateNow()
    }
    swap()
    window.addEventListener('focus', swap)
    window.addEventListener('online', swap)
    const rounds = setInterval(swap, 15_000)
    return () => {
      window.removeEventListener('focus', keepInStep)
      clearInterval(timer)
      window.removeEventListener('focus', swap)
      window.removeEventListener('online', swap)
      clearInterval(rounds)
    }
  }, [])

  // The end of a focus session, and its reminders. This only watches for
  // them: the digits are redrawn by the small components that show them, not
  // by the whole app.
  useEffect(() => {
    // Show it, unless that would pull the page out from under something being typed.
    const show = (said: string) => {
      if (busy()) latest.current.say(said)
      else latest.current.openView({ kind: 'focus' })
    }
    const announce = () => {
      const title = getFocus()?.title
      if (timeIsUp()) show('Time is up: ' + title)
    }
    const announceReminder = () => {
      const reminder = remind()
      if (reminder) show('Reminder: ' + reminder.label)
    }
    const timer = setInterval(() => {
      const session = getFocus()
      // The end is looked for first: it wins over a reminder due at the same moment.
      if (session && isDue(session, Date.now())) announce()
      else announceReminder()
    }, 250)
    // From the menu bar: its Pause and Stop, and its word that time is up or
    // a reminder is due (it keeps time while this window is hidden and its
    // timers are slowed). Its Pause continues from a reminder, as resuming does.
    const stopListening = onMenuBarCommand((command) => {
      if (command === 'ended') announce()
      if (command === 'reminder') announceReminder()
      if (command === 'pause') toggleFocus()
      if (command === 'stop') endFocus()
    })
    return () => {
      clearInterval(timer)
      stopListening()
    }
  }, [])

  useEffect(() => {
    // Text size keys, in the desktop app only: a browser has its own.
    const onZoomKey = (event: KeyboardEvent) => {
      if (!isDesktop || !event.metaKey || event.altKey) return
      const step = ({ '=': 0.1, '+': 0.1, '-': -0.1, _: -0.1 } as Record<string, number>)[event.key]
      if (step === undefined && event.key !== '0') return
      event.preventDefault()
      latest.current.setZoom(step === undefined ? 1 : latest.current.zoom + step)
    }
    // Cmd+K and Cmd+Z, taken before anything else on the page can see them:
    // in the Mac app's web view a key with Cmd that reaches the page late can
    // be lost to the app's menus.
    const onCommandKey = (event: KeyboardEvent) => {
      const app = latest.current
      const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      // Cmd+Z: undo the last thing done, anywhere. In a text field it is
      // left to the field, which undoes the typing.
      if (command && event.code === 'KeyZ') {
        const inField = event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')
        if (inField) return
        event.preventDefault()
        if (undoLast()) {
          play('undo')
          toast('Undone', { id: 'said', duration: 2000 })
        }
        return
      }
      // Cmd+K, or Option+K: search the whole app, from anywhere. Matched on
      // the key's place, since Option+K types a character of its own.
      const optionOnly = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
      if ((command || optionOnly) && event.code === 'KeyK') {
        event.preventDefault()
        app.search()
      }
    }
    const onKey = (event: KeyboardEvent) => {
      const app = latest.current
      if (event.key === 'Escape') {
        // A menu, dialog or select that was open has already taken this
        // Escape for itself and marked it handled.
        if (!event.defaultPrevented && isOpen(app.ui)) app.closeAll()
        return
      }
      // The target can be the document itself, which has no closest().
      // A dialog or side panel (Up next) is its own place: Space there is for
      // its buttons, not for pausing the timer behind it.
      const typing =
        event.target instanceof Element &&
        // A note being written is an editable region, not a field: N, Q
        // and the digits there are words, not shortcuts.
        event.target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]')
      if (typing || menuOpen.current || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'q' || event.key === 'n') {
        event.preventDefault()
        app.add()
      }
      // F opens the filter where there is one (Cmd+F, finding on the page, is left alone above).
      if (event.key === 'f' && (app.ui.view.kind === 'board' || app.ui.view.kind === 'timeline')) {
        event.preventDefault()
        setFilterOpen(true)
      }
      const views: Record<string, View> = {
        '1': { kind: 'inbox' },
        '2': { kind: 'today' },
        '3': { kind: 'upcoming' },
        '4': { kind: 'timeline' },
        '5': { kind: 'board' },
        '6': { kind: 'focus' },
        '7': { kind: 'timesheet' },
        '8': { kind: 'notes' },
        '9': { kind: 'completed' },
      }
      if (views[event.key]) app.openView(views[event.key])
      // Space pauses and resumes; during a reminder Space or Enter continues.
      // Enter on a button is left to the button, which may be Stop.
      const enter = event.key === 'Enter' && app.focus?.reminding && !(event.target instanceof Element && event.target.closest('button'))
      if ((event.key === ' ' || enter) && app.ui.view.kind === 'focus' && app.focus) {
        event.preventDefault()
        toggleFocus()
      }
    }
    document.addEventListener('keydown', onZoomKey, true)
    document.addEventListener('keydown', onCommandKey, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onZoomKey, true)
      document.removeEventListener('keydown', onCommandKey, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (failed !== null) return <p className="p-10">done could not open its tasks: {failed}</p>
  if (!ready) return null

  const onContextMenu = (event: MouseEvent) => {
    const element = event.target as Element
    // In a text field the browser's own menu (paste, spelling) is the useful
    // one, so the click is kept from reaching ours.
    if (element.closest('input, textarea, [contenteditable="true"]')) return event.stopPropagation()
    // A right-click on the menu itself does nothing.
    if (element.closest('[role="menu"]')) {
      event.preventDefault()
      return event.stopPropagation()
    }
    setMenuTarget(menuTargetOf(element))
  }

  // A finger never sends contextmenu in iOS's web view: the menu opens from
  // its own long press, with whatever target the last right-click left (23 Nov:
  // a long press on a task opened the workspace menu). So a touch sets the
  // target as it starts; the mouse keeps setting it on right-click above.
  const onTouchStart = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return
    const element = event.target as Element
    if (element.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return
    setMenuTarget(menuTargetOf(element))
  }

  const view = ui.view
  // Timeline and Board use the full width and open tasks over the page.
  const wide = view.kind === 'timeline' || view.kind === 'board'
  const editing = wide && !isMobile && ui.editing !== null ? data.tasks.find((t) => t.id === ui.editing) : undefined

  return (
    <AppContext.Provider value={app}>
      <ContextMenu onOpenChange={(open) => (menuOpen.current = open)}>
        {/* The trigger is the whole window. It would switch text selection
            off for everything inside it, which only the sidebar wants. */}
        <ContextMenuTrigger asChild className="select-auto">
          <div>
            <SidebarProvider
              className={cn(
                'md:h-svh',
                // Clear of the notch and the rounded corners on every layout:
                // the whole app sits inside the screen's safe area, on the
                // sides always and, in a window, above and below too (a
                // phone's bars keep clear of those themselves). The page's own
                // margin then starts at the safe edge, as in iOS's own apps.
                // All 0 on a Mac. The background reaches the edges.
                'bg-background pr-[var(--safe-right)] pl-[var(--safe-left)] md:pt-[var(--safe-top)] md:pb-[var(--safe-bottom)]',
                view.kind === 'lists' && 'max-md:bg-grouped',
              )}
              defaultOpen={sidebarWasOpen()}
              onContextMenu={onContextMenu}
              onPointerDownCapture={onTouchStart}
            >
              <AppSidebar />
              {/* In a window the content is a sheet lying on the sidebar. On a
                  phone it is the whole screen, edge to edge, kept clear of
                  the notch above and of the bar below. */}
              <SidebarInset
                className={cn(
                  // Flush in the window, a hairline from the sidebar (the
                  // sidebar's own edge): structure that is felt rather than
                  // drawn as a floating card.
                  'min-w-0 md:overflow-y-auto',
                  // On a phone: below iOS's navigation bar (44 points under
                  // the status bar), and clear of the tab bar and New Task.
                  'max-md:px-4 max-md:pt-[calc(var(--safe-top)+2.75rem)] max-md:pb-[calc(var(--safe-bottom)+8rem)]',
                  // Lists is a grouped screen: white groups on grey.
                  view.kind === 'lists' && 'max-md:bg-grouped',
                  wide ? 'md:p-8' : 'md:px-12 md:pt-10 md:pb-24',
                )}
              >
                <SidebarToggle />
                <div
                  ref={page}
                  key={view.kind === 'project' ? view.id : view.kind}
                  className={cn(
                    // A phone switches tabs at once, as iOS does, and pushes
                    // a screen opened from Lists in from the right.
                    isMobile ? !isTab(view) && 'animate-push' : 'animate-enter',
                    (view.kind === 'timeline' || view.kind === 'focus') && 'flex min-h-0 flex-1 flex-col',
                  )}
                >
                  {view.kind === 'lists' && <ListsScreen />}
                  {view.kind === 'timeline' && <Timeline />}
                  {view.kind === 'board' && <Board />}
                  {view.kind === 'focus' && <FocusView />}
                  {view.kind === 'timesheet' && <TimeSheet />}
                  {view.kind === 'notes' && <Notes />}
                  {view.kind === 'completed' && <Completed />}
                  {view.kind === 'settings' && <Settings />}
                  {view.kind === 'notifications' && <NotificationsScreen />}
                  {!wide &&
                    view.kind !== 'focus' &&
                    view.kind !== 'timesheet' &&
                    view.kind !== 'completed' &&
                    view.kind !== 'notes' &&
                    view.kind !== 'settings' &&
                    view.kind !== 'notifications' &&
                    view.kind !== 'lists' && <ListView />}
                </div>
                <TaskEditorDialog task={editing} />
                <MoveProjectDialog />
                <SearchDialog />
                <FindBar />
              </SidebarInset>
              <MobileQuickAdd />
              {isMobile && (
                <>
                  <TaskSheet task={ui.editing === null ? undefined : data.tasks.find((t) => t.id === ui.editing)} />
                  <NewTaskButton />
                  <TabBar />
                </>
              )}
            </SidebarProvider>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
          <AppMenu target={menuTarget} />
        </ContextMenuContent>
      </ContextMenu>
      {/* Light only; without this the toasts would follow the system. */}
      {/* On a phone the bottom belongs to the bar, so messages come from the top. */}
      <Toaster theme="light" position={isMobile ? 'top-center' : 'bottom-center'} />
    </AppContext.Provider>
  )
}
