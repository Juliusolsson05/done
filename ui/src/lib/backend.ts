// The tasks live in one SQLite file, reached through the desktop app's
// commands or the web app's /api. Which of the two is decided here and
// nowhere else; the rest of the interface cannot tell them apart.
import type { Change } from '@/lib/changes'
import type { Day } from '@/lib/days'
import { beginSignIn, CLOUD_URL, cloudSession, finishSignIn, forgetCloudSession } from '@/lib/cloud'
import { readMe, type Me } from '@/lib/me'
import type { Data, Task } from '@/lib/tasks'
import type { Note, SaveNote } from '@/lib/notes'
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

// An app that has signed in to a hosted account. Looked at once, when the
// window loads: signing in or out reloads the window, so it cannot go stale.
const hosted = tauri ? cloudSession() : null
// The tasks file on this machine, through the app's own commands. An app
// always works on its own file, signed in or not, so it keeps working with
// no connection; a signed-in app keeps that file in step with the account
// (see `replicate`).
const local = tauri
// Where the hosted server is: this same server for a browser, the one the app
// signed in to for an app. Only account calls and `replicate` go there from
// an app.
const at = hosted ? CLOUD_URL : ''
const who: Record<string, string> = hosted ? { authorization: `Bearer ${hosted.token}` } : {}
const get = (path: string) => fetch(at + path, { headers: who })

async function answer<T>(response: Response): Promise<T> {
  // The hosted server no longer knows who this is: the session ran out, or
  // was ended in another tab. Starting over shows the sign-in screen, and
  // nothing typed since is lost that could have been saved anyway.
  if (response.status === 401) {
    // For an app, the token is what stopped working. Without it the app is
    // back on its local file.
    if (hosted) forgetCloudSession()
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
  // An app knows its account from when it signed in. If the token has since
  // stopped working, the first load of tasks finds that out.
  if (hosted) return { mode: 'cloud', account: hosted.account }
  if (tauri) return { mode: 'local' }
  const response = await fetch('/api/me')
  return readMe(response.status, await response.json().catch(() => null))
}

export const loadState = (today: Day): Promise<Data> =>
  local ? local.core.invoke<Data>('state', { today }) : get('/api/state?today=' + today).then((r) => answer<Data>(r))

export const sync = (change: Change): Promise<{ rev: number }> =>
  local ? local.core.invoke<{ rev: number }>('sync', { change }) : post<{ rev: number }>('/api/sync', change)

// The time sheet. Written through calls of its own rather than `sync`: a
// row is only ever added, so it never has to wait for the tasks file's
// revision, and the end of a block is never lost to another window's save.
function post<T>(path: string, body: unknown): Promise<T> {
  return fetch(at + path, { method: 'POST', headers: { 'content-type': 'application/json', ...who }, body: JSON.stringify(body) }).then((r) => answer<T>(r))
}

export const loadEntries = (day: Day): Promise<Entry[]> =>
  local ? local.core.invoke<Entry[]>('entries', { day }) : get('/api/entries?day=' + day).then((r) => answer<Entry[]>(r))
export const recordEntry = (entry: NewEntry): Promise<Entry> =>
  local ? local.core.invoke<Entry>('record_entry', { entry }) : post<Entry>('/api/entries', entry)
export const deleteEntry = (id: number): Promise<void> =>
  local ? local.core.invoke<void>('delete_entry', { id }) : post<unknown>('/api/entries/delete', { id }).then(() => undefined)

// Finished tasks for the Completed page: more than a window keeps (it only
// has today's), the most recently finished first.
export const loadFinished = (): Promise<Task[]> =>
  local ? local.core.invoke<Task[]>('finished') : get('/api/finished').then((r) => answer<Task[]>(r))

// Notes, through calls of their own like the time sheet: typing a note never
// waits for, or upsets, the tasks file's revision.
export const loadNotes = (): Promise<Note[]> => (local ? local.core.invoke<Note[]>('notes') : get('/api/notes').then((r) => answer<Note[]>(r)))
export const saveNote = (note: SaveNote): Promise<Note> => (local ? local.core.invoke<Note>('save_note', { note }) : post<Note>('/api/notes', note))
export const deleteNote = (id: number): Promise<void> =>
  local ? local.core.invoke<void>('delete_note', { id }) : post<unknown>('/api/notes/delete', { id }).then(() => undefined)

// One round of keeping a signed-in app's file in step with its account: send
// what changed here, take in what changed elsewhere. True when something
// arrived, so the window reloads. Does nothing for a browser or an app that
// is not signed in.
export const canReplicate = tauri !== undefined && hosted !== null
export async function replicate(): Promise<boolean> {
  if (!tauri || !hosted) return false
  const outbox = await tauri.core.invoke<{ upto: number }>('outbox')
  const response = await fetch(at + '/api/replicate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...who },
    body: JSON.stringify(outbox),
    // A slow network must not hold up saving: saves wait behind this.
    signal: AbortSignal.timeout(20_000),
  })
  const reply = await answer<unknown>(response)
  return tauri.core.invoke<boolean>('inbox', { reply, upto: outbox.upto })
}

// Both are sent as JSON, like every call that changes something: another
// site can make a browser post a form here, but not JSON.
export const signOut = async (): Promise<void> => {
  // An app's session is its token: forgetting it is signing out. A browser's
  // is a cookie only the server can take back.
  // The app keeps its file, with everything synced so far, and goes on
  // without an account.
  if (hosted) forgetCloudSession()
  else await post<unknown>('/auth/signout', {})
  location.reload()
}
export const deleteAccount = async (): Promise<void> => {
  await post<unknown>('/api/account/delete', {})
  if (hosted) forgetCloudSession()
  location.reload()
}

// Signing in from an app. It can be offered where the app was built knowing
// a hosted server and is not signed in yet.
export const canSignIn = tauri !== undefined && CLOUD_URL !== null && hosted === null
export const signIn = (): Promise<void> => beginSignIn((url) => tauri!.core.invoke<void>('open_in_browser', { url }))

// A link in a task's notes. The apps open it in the person's own browser:
// inside the app's window it would replace the task list.
export const openLink = (url: string): void => {
  if (tauri) void tauri.core.invoke('open_in_browser', { url })
  else window.open(url, '_blank', 'noopener')
}
// The browser hands a finished sign-in back as a link. Returns how to stop listening.
export const onSignedIn = (done: () => void): (() => void) => {
  const listening = tauri?.event.listen<string>('opened-link', (event) => {
    void finishSignIn(event.payload).then((ok) => ok && done())
  })
  return () => void listening?.then((stop) => stop())
}

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
