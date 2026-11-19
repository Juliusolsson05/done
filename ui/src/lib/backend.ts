// The tasks live in one SQLite file, reached through the desktop app's
// commands or the web app's /api. Which of the two is decided here and
// nowhere else; the rest of the interface cannot tell them apart.
import type { Change } from '@/lib/changes'
import type { Day } from '@/lib/days'
import { readMe, type Me } from '@/lib/me'
import type { Data } from '@/lib/tasks'
import type { Entry, NewEntry } from '@/lib/time-sheet'

// What the desktop app knows about itself: its version, where its program is
// (for connecting an agent), and whether an update is waiting for a restart.
export interface Info {
  version: string | null
  mcpCommand: string
  updateReady: string | null
}

// The desktop shell sets `withGlobalTauri`, so its API is a global and no
// package is needed for it.
interface Tauri {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }
  webview: { getCurrentWebview(): { setZoom(factor: number): Promise<void> } }
  event: { listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> }
}
declare global {
  interface Window {
    __TAURI__?: Tauri
  }
}
const tauri = window.__TAURI__

export const isDesktop = tauri !== undefined

async function answer<T>(response: Response): Promise<T> {
  // The hosted server no longer knows who this is: the session ran out, or
  // was ended in another tab. Starting over shows the sign-in screen, and
  // nothing typed since is lost that could have been saved anyway.
  if (response.status === 401) {
    location.reload()
    throw new Error('signed out')
  }
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(data.error || 'failed')
  return data
}

// Asked before anything else is loaded. The desktop app has no accounts and
// does not need to ask.
export const loadMe = async (): Promise<Me> => {
  if (tauri) return { mode: 'local' }
  const response = await fetch('/api/me')
  return readMe(response.status, await response.json().catch(() => null))
}

export const loadState = (today: Day): Promise<Data> =>
  tauri ? tauri.core.invoke<Data>('state', { today }) : fetch('/api/state?today=' + today).then((r) => answer<Data>(r))

export const sync = (change: Change): Promise<{ rev: number }> =>
  tauri
    ? tauri.core.invoke<{ rev: number }>('sync', { change })
    : fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) }).then((r) =>
        answer<{ rev: number }>(r),
      )

// The time sheet. Written through calls of its own rather than `sync`: a
// row is only ever added, so it never has to wait for the tasks file's
// revision, and the end of a block is never lost to another window's save.
const post = <T>(url: string, body: unknown): Promise<T> =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => answer<T>(r))

export const loadEntries = (day: Day): Promise<Entry[]> =>
  tauri ? tauri.core.invoke<Entry[]>('entries', { day }) : fetch('/api/entries?day=' + day).then((r) => answer<Entry[]>(r))
export const recordEntry = (entry: NewEntry): Promise<Entry> =>
  tauri ? tauri.core.invoke<Entry>('record_entry', { entry }) : post<Entry>('/api/entries', entry)
export const deleteEntry = (id: number): Promise<void> =>
  tauri ? tauri.core.invoke<void>('delete_entry', { id }) : post<unknown>('/api/entries/delete', { id }).then(() => undefined)

// Both are sent as JSON, like every call that changes something: another
// site can make a browser post a form here, but not JSON.
export const signOut = (): Promise<void> => post<unknown>('/auth/signout', {}).then(() => location.reload())
export const deleteAccount = (): Promise<void> => post<unknown>('/api/account/delete', {}).then(() => location.reload())

// In a browser there is no app to ask, so the usual install path stands in.
export const BROWSER_INFO: Info = { version: null, mcpCommand: '/Applications/done.app/Contents/MacOS/done', updateReady: null }
export const loadInfo = (): Promise<Info> => (tauri ? tauri.core.invoke<Info>('info') : Promise.resolve(BROWSER_INFO))

export const restart = (): void => {
  void tauri?.core.invoke('restart')
}

// Text size. Only the desktop app needs this: a browser has its own zoom on
// the same keys. It is the web view's real zoom, not a CSS scale, so layout
// and sharpness stay correct at every size.
export const setWebviewZoom = (factor: number): void => {
  void tauri?.webview.getCurrentWebview().setZoom(factor)
}

// The focus timer in the menu bar. The window owns the session and hands over
// its times whenever they change; the menu bar counts down from them by
// itself, because a hidden window's own timers are slowed or stopped. In a
// browser there is no menu bar and nothing to tell.
export interface MenuBarTimes {
  endsAt: number | null
  remaining: number | null
  // When the next reminder comes. The menu bar says 'reminder' then, because
  // a hidden window would not notice by itself.
  reminderAt: number | null
  // A reminder is showing: the menu bar rings and brings the window forward.
  reminding: boolean
}
export const showInMenuBar = (session: MenuBarTimes | null): void => {
  void tauri?.core.invoke('focus_set', { session })
}

// The menu bar's own Pause and Stop, and its word that time is up or that a
// reminder may be due.
export type MenuBarCommand = 'pause' | 'stop' | 'ended' | 'reminder'
// Returns how to stop listening.
export const onMenuBarCommand = (handler: (command: MenuBarCommand) => void): (() => void) => {
  const listening = tauri?.event.listen<MenuBarCommand>('focus-command', (event) => handler(event.payload))
  return () => void listening?.then((stop) => stop())
}
