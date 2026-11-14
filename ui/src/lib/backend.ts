// The tasks live in one SQLite file, reached through the desktop app's
// commands or the web app's /api. Which of the two is decided here and
// nowhere else; the rest of the interface cannot tell them apart.
import type { Change } from '@/lib/changes'
import type { Day } from '@/lib/days'
import type { Data } from '@/lib/tasks'

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
}
declare global {
  interface Window {
    __TAURI__?: Tauri
  }
}
const tauri = window.__TAURI__

export const isDesktop = tauri !== undefined

async function answer<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(data.error || 'failed')
  return data
}

export const loadState = (today: Day): Promise<Data> =>
  tauri ? tauri.core.invoke<Data>('state', { today }) : fetch('/api/state?today=' + today).then((r) => answer<Data>(r))

export const sync = (change: Change): Promise<{ rev: number }> =>
  tauri
    ? tauri.core.invoke<{ rev: number }>('sync', { change })
    : fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) }).then((r) =>
        answer<{ rev: number }>(r),
      )

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
