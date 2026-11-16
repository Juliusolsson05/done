import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { toast } from 'sonner'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AppMenu, menuTargetOf, type MenuTarget } from '@/components/app-menu'
import { AppSidebar } from '@/components/app-sidebar'
import { Board } from '@/components/board'
import { FocusView } from '@/components/focus-view'
import { ListView } from '@/components/list-view'
import { Settings } from '@/components/settings'
import { TaskEditorDialog } from '@/components/task-editor'
import { TimeSheet } from '@/components/time-sheet'
import { Timeline } from '@/components/timeline'
import { AppContext, type App as AppValue, type Ui } from '@/lib/app-context'
import { isDesktop, onMenuBarCommand, setWebviewZoom } from '@/lib/backend'
import { addDays, dayOf, TODAY } from '@/lib/days'
import { DEFAULT_MINUTES, isDue } from '@/lib/focus'
import { endFocus, getFocus, handOff, onRecordFailed, remind, subscribeFocus, timeIsUp, toggleFocus } from '@/lib/focus-store'
import { play } from '@/lib/sounds'
import { change, getSnapshot, load, onLost, refresh, subscribe } from '@/lib/store'
import { clearsToday, deleteProject, deleteTask, markDone, markOpen, type Data, type View } from '@/lib/tasks'
import { cn } from '@/lib/utils'

const CLOSED = { adding: false, asGoal: false, editing: null, newProject: false, renaming: false, confirmDelete: false }
const isOpen = (ui: Ui) => ui.adding || ui.editing !== null || ui.newProject || ui.renaming || ui.confirmDelete

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
    tlStart: addDays(TODAY, -4),
    focusPick: null,
    focusMinutes: DEFAULT_MINUTES,
  }))
  const [noticed, setNoticed] = useState<number | null>(null)
  const [zoom, setZoomState] = useState(storedZoom)
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({ kind: 'space' })
  const dragging = useRef(false)
  const menuOpen = useRef(false)

  const closeAll = () => setUi((u) => ({ ...u, ...CLOSED }))

  // One message at a time, like one thing said at a time: a new one takes
  // the place of the last, and takes its Undo with it.
  const say = (text: string, undo?: (data: Data) => Data) => {
    const onUndo = () => {
      if (!undo) return
      play('undo')
      change(undo)
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
    ui,
    zoom,
    focus,
    noticed,
    dragging,
    closeAll,
    say,
    setZoom,
    openView: (view: View) => setUi((u) => ({ ...u, ...CLOSED, view })),
    // Settings, Focus and the time sheet have no list to add to, so adding from there goes to Inbox.
    add: () =>
      setUi((u) => ({
        ...u,
        ...CLOSED,
        view: u.view.kind === 'settings' || u.view.kind === 'focus' || u.view.kind === 'timesheet' ? { kind: 'inbox' } : u.view,
        adding: true,
      })),
    addGoal: () => setUi((u) => ({ ...u, ...CLOSED, adding: true, asGoal: true })),
    edit: (id) => setUi((u) => ({ ...u, ...CLOSED, editing: id })),
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
      // Today's goal, or the last thing left in Today, gets the fuller sound.
      const big = task.goalDay === TODAY || (ui.view.kind === 'today' && clearsToday(data.tasks, id, TODAY))
      play(big ? 'completeBig' : 'complete')
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
      latest.current.say('That focus block could not be written to the time sheet.')
    })
  }, [])

  // Something is under your hands: typing, dragging or a menu open. Nothing
  // may change the page then. Reads only refs, so set-up-once listeners can call it.
  const busy = () => {
    const { ui } = latest.current
    return ui.adding || ui.editing !== null || ui.newProject || ui.renaming || dragging.current || menuOpen.current
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
    return () => {
      window.removeEventListener('focus', keepInStep)
      clearInterval(timer)
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
        event.target.closest('input, textarea, select, [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]')
      if (typing || menuOpen.current || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'q' || event.key === 'n') {
        event.preventDefault()
        app.add()
      }
      const views: Record<string, View> = {
        '1': { kind: 'inbox' },
        '2': { kind: 'today' },
        '3': { kind: 'upcoming' },
        '4': { kind: 'timeline' },
        '5': { kind: 'board' },
        '6': { kind: 'focus' },
        '7': { kind: 'timesheet' },
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
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onZoomKey, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (failed !== null) return <p className="p-10">done could not open its tasks: {failed}</p>
  if (!ready) return null

  const onContextMenu = (event: MouseEvent) => {
    const element = event.target as Element
    // In a text field the browser's own menu (paste, spelling) is the useful
    // one, so the click is kept from reaching ours.
    if (element.closest('input, textarea')) return event.stopPropagation()
    // A right-click on the menu itself does nothing.
    if (element.closest('[role="menu"]')) {
      event.preventDefault()
      return event.stopPropagation()
    }
    setMenuTarget(menuTargetOf(element))
  }

  const view = ui.view
  // Timeline and Board use the full width and open tasks over the page.
  const wide = view.kind === 'timeline' || view.kind === 'board'
  const editing = wide && ui.editing !== null ? data.tasks.find((t) => t.id === ui.editing) : undefined

  return (
    <AppContext.Provider value={app}>
      <ContextMenu onOpenChange={(open) => (menuOpen.current = open)}>
        {/* The trigger is the whole window. It would switch text selection
            off for everything inside it, which only the sidebar wants. */}
        <ContextMenuTrigger asChild className="select-auto">
          <div>
            <SidebarProvider className="max-md:flex-col md:h-svh" onContextMenu={onContextMenu}>
              <AppSidebar />
              <SidebarInset className={cn('m-2 min-w-0 overflow-y-auto rounded-xl shadow-sm ring-1 ring-foreground/5 max-md:w-auto md:ml-0', wide ? 'p-8' : 'px-12 pt-10 pb-24 max-md:px-4 max-md:pt-6')}>
                <div
                  key={view.kind === 'project' ? view.id : view.kind}
                  className={cn('animate-enter', (view.kind === 'timeline' || view.kind === 'focus') && 'flex min-h-0 flex-1 flex-col')}
                >
                  {view.kind === 'timeline' && <Timeline />}
                  {view.kind === 'board' && <Board />}
                  {view.kind === 'focus' && <FocusView />}
                  {view.kind === 'timesheet' && <TimeSheet />}
                  {view.kind === 'settings' && <Settings />}
                  {!wide && view.kind !== 'focus' && view.kind !== 'timesheet' && view.kind !== 'settings' && <ListView />}
                </div>
                <TaskEditorDialog task={editing} />
              </SidebarInset>
            </SidebarProvider>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
          <AppMenu target={menuTarget} />
        </ContextMenuContent>
      </ContextMenu>
      {/* Light only; without this the toasts would follow the system. */}
      <Toaster theme="light" position="bottom-center" />
    </AppContext.Provider>
  )
}
