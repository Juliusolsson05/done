// The tasks live in one SQLite file, reached through the desktop app's
// commands or the web app's /api. Which of the two is decided here and
// nowhere else; the rest of the interface cannot tell them apart.
import { toast } from 'sonner'
import type { Change } from '@/lib/changes'
import type { Day } from '@/lib/days'
import { CLOUD_URL, cloudSession, finishSignIn, forgetCloudSession, rememberAppleUser, sameAppleSession, signInFromApp, signInWithAppleToken, signInWithPassword, type SheetAnswer } from '@/lib/cloud'
import { newId } from '@/lib/ids'
import { readMe, type Me } from '@/lib/me'
import { isIosAgent, windowsDevice } from '@/lib/platform'
import type { Data, Task } from '@/lib/tasks'
import type { Note, SaveNote } from '@/lib/notes'
import type { Entry, NewEntry } from '@/lib/time-sheet'
import { unsentCount, type Held, type Left, type Pending } from '@/lib/account-switch'

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

// The same app runs on a Mac and on an iPhone or iPad, and `isDesktop` is true
// on all three: these two tell them apart, for what only one of them has (the
// Mac's text size, its menu bar, connecting an agent). See lib/platform.ts.
const ios = typeof navigator !== 'undefined' && isIosAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0)
export const isIosApp = isDesktop && ios
export const isMacApp = isDesktop && !ios && typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

// Today for the Home and Lock Screen widgets (lib/widget-snapshot.ts); the app
// stores it where the widget extension reads it, or removes it for `null`
// (signed out). iPhone and iPad only. The same snapshot is not sent twice:
// App renders build new task arrays often, and each send rewrites the file and
// reloads every widget (review of #74).
let lastSnapshot: string | null = null
// Signed out or deleted: the widgets must not keep showing the account's
// tasks on the Home Screen (review of #74). The app removes their file.
const clearWidgets = async (): Promise<void> => {
  lastSnapshot = null
  if (isIosApp) await tauri?.core.invoke('widget_snapshot', { snapshot: null }).catch(() => {})
}
export const sendWidgetSnapshot = (snapshot: unknown): void => {
  if (!isIosApp) return
  const json = JSON.stringify(snapshot)
  if (json === lastSnapshot) return
  lastSnapshot = json
  void tauri?.core.invoke('widget_snapshot', { snapshot })
}

// The window's safe area as the iPhone or iPad app reads it natively, in
// points: [top, right, bottom, left]. Null anywhere else, or if the app could
// not tell. See lib/safe-area.ts for why this exists alongside env().
export const nativeSafeArea = async (): Promise<[number, number, number, number] | null> =>
  isIosApp && tauri ? ((await tauri.core.invoke<[number, number, number, number] | null>('safe_area')) ?? null) : null

// The Mac app as a disk image, signed with a Developer ID and notarized so it
// opens with one double-click: made on a Mac by done-infra's notarize-mac.sh
// and kept on the release `mac`, a pre-release that is never "latest" (the
// installed apps ask "latest" for updates). It can be a few versions behind;
// the app updates itself once it runs.
export const WINDOWS_DOWNLOAD = 'https://github.com/Juliusolsson05/done/releases/latest/download/done-windows-x64-setup.exe'
export const MAC_DOWNLOAD = 'https://github.com/Juliusolsson05/done/releases/download/mac/Done.dmg'

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
    // For an app, the token is what stopped working (tokens last 30 days).
    // Without it the app is back on its local file. Nobody chose to sign
    // out, so nothing unsent is taken off the device: marked "ended" first,
    // finished on the next load (`settled`), and the person is told.
    if (hosted) {
      await markLeaving('ended').catch(() => {})
      forgetCloudSession()
    }
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

// The account leaving this device: marked in the file before the session is
// forgotten or the account deleted, done after (crates/core/src/account.rs).
// 'deleting' is written before the server is asked to delete, 'deleted'
// once it said yes: only that one is finished as a deletion.
type Leaving = 'ended' | 'deleting' | 'signed-out' | 'deleted'

// Which app wrote a mark: an id in this app's own web storage. The "done
// next" preview has storage of its own, so it never finishes the real app's
// mark (issue #120). Null where storage is refused: such a mark is anyone's.
const OWNER = 'done-app-owner'
function owner(): string | null {
  try {
    let id = localStorage.getItem(OWNER)
    if (!id) {
      id = newId()
      localStorage.setItem(OWNER, id)
    }
    return id
  } catch {
    return null
  }
}

// A write to the file that must not be lost to a moment's lock: tried three
// times, and the last error is not swallowed.
async function tries<T>(step: () => Promise<T>, times = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      if (attempt >= times) throw error
    }
  }
}
const markLeaving = (how: Leaving | null): Promise<unknown> =>
  tauri ? tries(() => tauri.core.invoke('mark_leaving', { how, by: owner() })) : Promise.resolve()
const finishLeaving = (): Promise<Left | null> => tauri?.core.invoke<Left | null>('finish_leaving', { by: owner() }).catch(() => null) ?? Promise.resolve(null)

// An app that is not signed in first finishes a leaving it marked and did
// not finish: a reload or a crash came between (the 401 above reloads at
// once). Without a mark of its own it changes nothing: the "done next"
// preview app is never signed in and runs on the real file. A signed-in app
// that finds its own mark (a crash before the session was forgotten)
// completes it: what the person chose, or a session already gone; a
// deletion the server never confirmed is taken back by core. Once per window.
let leftOver: Promise<Left | null> | null = null
const settled = (): Promise<Left | null> => {
  if (!tauri) return Promise.resolve(null)
  if (!hosted) return (leftOver ??= finishLeaving())
  return (leftOver ??= tauri.core
    .invoke<Leaving | null>('own_mark', { by: owner() })
    .catch(() => null)
    .then(async (mark) => {
      if (!mark) return null
      forgetCloudSession()
      await finishLeaving()
      await clearWidgets()
      location.reload()
      // The window is starting over; nothing more is loaded.
      return new Promise<never>(() => {})
    }))
}
// What that did, for the window to say (a session that ended).
export const leftOnLoad = settled

// Changes on this device waiting for an account that is signed out.
export const waitingHere = (): Promise<Held | null> =>
  tauri && !hosted ? tauri.core.invoke<Held | null>('waiting').catch(() => null) : Promise.resolve(null)

export const loadState = (today: Day): Promise<Data> =>
  local ? settled().then(() => local.core.invoke<Data>('state', { today })) : get('/api/state?today=' + today).then((r) => answer<Data>(r))

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
// what changed here, take in what changed elsewhere. `arrived` when something
// did, so the window reloads. Does nothing for a browser or an app that is
// not signed in. `held` when the file holds another account's tasks: then
// nothing is sent until the person says (`takeOverHere`).
export const canReplicate = tauri !== undefined && hosted !== null
const account = hosted && { id: hosted.account.id, email: hosted.account.email }
export async function replicate(): Promise<{ arrived: boolean; held: Held | null }> {
  if (!tauri || !hosted) return { arrived: false, held: null }
  const outbox = await tauri.core.invoke<{ upto: number; renumbered: number; held?: Held | null }>('outbox', { account })
  if (outbox.held) return { arrived: false, held: outbox.held }
  const response = await fetch(at + '/api/replicate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...who },
    body: JSON.stringify(outbox),
    // A slow network must not hold up saving: saves wait behind this.
    signal: AbortSignal.timeout(20_000),
  })
  const reply = await answer<unknown>(response)
  const arrived = await tauri.core.invoke<boolean>('inbox', { reply, upto: outbox.upto, account })
  // The first round gives rows counted up on this device new ids; what the
  // window holds must be loaded again whether or not anything arrived.
  return { arrived: arrived || outbox.renumbered > 0, held: null }
}

// The person's answer to a held round: the other account's tasks come off
// this device, which is now this account's. Done before any round.
export const takeOverHere = (): Promise<void> => (tauri && hosted ? tauri.core.invoke<void>('take_over', { account }) : Promise.resolve())

// How many changes here have not reached the account: asked before signing out.
export async function unsentChanges(): Promise<number> {
  if (!tauri || !hosted) return 0
  return unsentCount(await tauri.core.invoke<Pending>('outbox', { account }))
}

// Workspaces: made, changed and joined on the hosted server, never on a
// device's own file (a device learns the result at its next sync). Only for a
// window that has an account: its data has a team.
export const workspaceCalls = {
  create: (name: string) => post<{ space: number }>('/api/workspaces', { name }),
  rename: (space: number, name: string) => post<unknown>('/api/workspaces/rename', { space, name }),
  remove: (space: number) => post<unknown>('/api/workspaces/delete', { space }),
  invite: (space: number, email: string) => post<{ invite: number; link: string }>('/api/workspaces/invite', { space, email }),
  link: (invite: number) => post<{ invite: number; link: string }>('/api/workspaces/invite-link', { invite }),
  revoke: (invite: number) => post<unknown>('/api/workspaces/revoke', { invite }),
  accept: (invite: number) => post<{ space: number }>('/api/invites/accept', { invite }),
  decline: (invite: number) => post<unknown>('/api/invites/decline', { invite }),
  removeMember: (space: number, account: string) => post<unknown>('/api/workspaces/remove', { space, account }),
  leave: (space: number) => post<unknown>('/api/workspaces/leave', { space }),
  moveProject: (project: number, space: number) => post<unknown>('/api/projects/move', { project, space }),
  read: () => post<unknown>('/api/notifications/read', {}),
}

// A two-minute ticket to the live notes service, for one workspace note (to
// write it with the others) or a workspace (to see who is in which note).
export const liveTicket = (ask: { note?: number; space?: number }) => post<{ ticket: string; url: string }>('/api/live/ticket', ask)

// Both are sent as JSON, like every call that changes something: another
// site can make a browser post a form here, but not JSON.
// `how`: 'signed-out' when the person chose to (and was told of anything
// unsent: lib/leave.ts), 'ended' when they did not (Apple ended the
// credential, or this device holds another account's tasks), which keeps
// unsent workspace changes for when the account signs in again.
export const signOut = async (how: 'signed-out' | 'ended' = 'signed-out'): Promise<void> => {
  // An app's session is its token: forgetting it is signing out. A browser's
  // is a cookie only the server can take back.
  // The app keeps its own tasks, with everything synced so far, and goes on
  // without an account; shared workspaces leave the device. Marked first, so
  // a reload or a crash from here on still ends in the clean-up.
  if (hosted) {
    // Not marked (the file would not take it three times): signed out all
    // the same; the shared workspaces then stay until a round or a sign-out.
    await markLeaving(how).catch(() => {})
    forgetCloudSession()
    await finishLeaving()
  } else await post<unknown>('/auth/signout', {})
  await clearWidgets()
  location.reload()
}
export const deleteAccount = async (): Promise<void> => {
  // Marked 'deleting' before the server is asked, so a round answered 401
  // meanwhile (which reloads at once) still ends in the clean-up; finished
  // as a session that ended, since the server has not said yes. Not marked,
  // not asked. A refusal takes the mark back, tried until it holds or said;
  // a 401 keeps it. 'deleted' only once the server confirmed.
  if (hosted) await markLeaving('deleting')
  try {
    await post<unknown>('/api/account/delete', {})
  } catch (error) {
    if (hosted && !(error instanceof Error && error.message === 'signed out')) {
      await markLeaving(null).catch(() => {
        throw new Error('Your account was not deleted, and done could not tidy up after it. Try again.')
      })
    }
    throw error
  }
  if (hosted) {
    // If this cannot be written, 'deleting' stays, and is finished as a
    // session that ended: less is taken off, nothing is lost.
    await markLeaving('deleted').catch(() => {})
    forgetCloudSession()
    // The account is gone: what stays is plain local data.
    await finishLeaving()
  }
  await clearWidgets()
  location.reload()
}

// Signing in from an app. It can be offered where the app was built knowing
// a hosted server and is not signed in yet.
export const canSignIn = tauri !== undefined && CLOUD_URL !== null && hosted === null

// done's MCP server on the internet, for apps that connect by address
// (Claude's custom connectors): the hosted server's /mcp. In a browser that
// is this same site; in an app, the server it signs in to.
// A test has no page and no location; it gets no address rather than a crash
// on import (which broke CI and the release builds after #82).
export const REMOTE_MCP: string | null = tauri
  ? CLOUD_URL
    ? `${CLOUD_URL}/mcp`
    : null
  : typeof location === 'undefined'
    ? null
    : `${location.origin}/mcp`
// Sign in with Google. A Mac or PC opens the person's own browser, which
// hands the finished sign-in back as a link (`onSignedIn`). An iPhone or iPad
// stays in the app (a sheet over it, DoneNative.swift) and starts over signed
// in when the sheet closes; closing it by hand changes nothing.
// One at a time: a second tap while the first is under way would start a
// second sign-in with a new secret, and the first sheet's answer would then
// be refused after the person had finished with Google. It gets the first's
// promise instead.
let signingIn: Promise<void> | null = null
export const signIn = (): Promise<void> => {
  signingIn ??= signInFromApp({
    ios: isIosApp,
    openBrowser: (url) => tauri!.core.invoke<void>('open_in_browser', { url }),
    presentSheet: (url) => tauri!.core.invoke<SheetAnswer>('web_sign_in', { url }),
  })
    .then((signedIn) => {
      if (signedIn) location.reload()
    })
    .finally(() => {
      signingIn = null
    })
  return signingIn
}

// Sign in with Apple: the iPhone and iPad app only, where the App Store asks
// for it next to Google. The sheet is native (DoneNative.swift); the token it
// gives goes to the server, and the app starts over signed in, as after Google.
// Resolves false when the person closed the sheet.
export const canSignInWithApple = canSignIn && isIosApp
export const needsAppleVerification = isIosApp && Boolean(hosted?.account.id?.startsWith('apple') && !hosted.appleUser)
export const signInWithApple = async (): Promise<boolean> => {
  const answer = await tauri!.core.invoke<{ token?: string; code?: string; name?: string; user?: string; error?: string }>('apple_sign_in')
  if (answer.error === 'cancelled') return false
  if (!answer.token || !answer.code || !answer.user) throw new Error('Signing in with Apple did not work. Try again.')
  if (hosted) await rememberAppleUser(hosted, answer.user)
  else await signInWithAppleToken(answer.token, answer.code, answer.name ?? '', answer.user)
  location.reload()
  return true
}

// The App Review login (a username and password the server holds). Shown in
// the apps behind a small link: it is for Apple's reviewers, who have no
// Google account for done.
export const signInWithReviewPassword = async (username: string, password: string): Promise<void> => {
  await signInWithPassword(username, password)
  location.reload()
}

// A link in a task's notes. The apps open it in the person's own browser:
// inside the app's window it would replace the task list.
export const openLink = (url: string): void => {
  if (tauri) void tauri.core.invoke('open_in_browser', { url })
  else window.open(url, '_blank', 'noopener')
}
// A notification may arrive after another sign-in or a window reload. Only
// the current watch can sign out the exact session it was started for.
// `onEnded`: the window's own sign-out (lib/leave.ts), which also stops
// syncing and ends a focus session on a workspace task; without one, signs
// out as a session that ended.
export const watchAppleSession = (onEnded?: () => Promise<unknown>): (() => void) | undefined => {
  if (!isIosApp || !tauri) return
  if (!hosted?.appleUser || !hosted.account.id?.startsWith('apple')) {
    void tauri.core.invoke('watch_apple_user', { user: '', id: '' })
    return
  }
  const id = crypto.randomUUID()
  let active = true
  const listening = tauri.event.listen<string>('apple-credential-ended', ({ payload }) => {
    if (active && payload === id && sameAppleSession(cloudSession(), hosted)) void (onEnded ? onEnded() : signOut('ended'))
  })
  void listening.then(() => {
    if (active) return tauri.core.invoke('watch_apple_user', { user: hosted.appleUser, id })
  })
  return () => {
    active = false
    void listening.then((stop) => stop())
  }
}

// The browser hands a finished sign-in back as a link. Returns how to stop listening.
export const onSignedIn = (done: () => void): (() => void) => {
  if (!tauri) return () => {}
  const shell = tauri
  let active = true
  const receive = async () => {
    if (!active) return
    const link = await shell.core.invoke<string | null>('take_opened_link')
    if (link && await finishSignIn(link)) done()
  }
  const listening = shell.event.listen('opened-link', receive)
  // Subscribe before draining. Windows can hand the app a URL before its
  // webview starts, or start a second process while the first is open.
  void listening.then(receive)
  return () => {
    active = false
    void listening.then((stop) => stop())
  }
}

// Windows users can choose their install folder. Only the native app knows the executable's path.
export const BROWSER_INFO: Info = { version: null, mcpCommand: windowsDevice ? '' : '/Applications/done.app/Contents/MacOS/done', updateReady: null }
export const loadInfo = (): Promise<Info> => (tauri ? tauri.core.invoke<Info>('info') : Promise.resolve(BROWSER_INFO))

export const restart = async (): Promise<void> => {
  try {
    await tauri?.core.invoke('restart')
  } catch (error) {
    toast('Couldn’t install the update', { id: 'said', description: String(error) })
  }
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
  // What is being worked on: the Dynamic Island shows it on a phone.
  title?: string
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
