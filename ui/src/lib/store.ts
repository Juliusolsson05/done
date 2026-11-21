// The tasks and projects this window is showing, and keeping them saved.
// One store for the whole interface; React reads it with useSyncExternalStore.
import { BROWSER_INFO, loadInfo, loadState, sync, type Info } from '@/lib/backend'
import { changeSet, picture, type Picture } from '@/lib/changes'
import { TODAY } from '@/lib/days'
import type { Data } from '@/lib/tasks'
import { recordChange } from '@/lib/undo'

export interface Snapshot {
  data: Data
  info: Info
}

let snapshot: Snapshot = { data: { rev: 0, nextId: 1, projects: [], tasks: [] }, info: BROWSER_INFO }
// What the file held when this window last loaded or saved.
let saved: Picture = new Map()
let pending: Promise<void> = Promise.resolve()
// Told when a save was lost, so the interface can close what is open and say so.
let lost: (stale: boolean) => void = () => {}
const listeners = new Set<() => void>()

const set = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getSnapshot = (): Snapshot => snapshot
export const onLost = (handler: (stale: boolean) => void) => {
  lost = handler
}

async function reload() {
  const data = await loadState(TODAY)
  saved = picture(data)
  set({ data })
}

export async function load() {
  await reload()
  set({ info: await loadInfo() })
}

// The interface changes its data first and saves after, so nothing waits on
// the disk. Saves run one at a time, in order. Every change can be undone
// with Cmd+Z, except an undo itself (`record` false).
export function change(fn: (data: Data) => Data, record = true) {
  const before = snapshot.data
  set({ data: fn(before) })
  pending = pending.then(push)
  if (record && snapshot.data !== before) recordChange(before, snapshot.data, (undo) => change(undo, false))
}

async function push() {
  const now = picture(snapshot.data)
  const changes = changeSet(saved, now, snapshot.data.rev)
  if (!changes) return
  try {
    const { rev } = await sync(changes)
    // `now`, not a fresh picture: changes made while this save was in flight
    // are not saved yet and must still count as different.
    saved = now
    set({ data: { ...snapshot.data, rev } })
  } catch (error) {
    // Another window saved first ("stale"), or the save was refused. Either
    // way what is on screen is no longer true, so show what the file holds.
    const stale = String(error instanceof Error ? error.message : error) === 'stale'
    try {
      await reload()
    } catch {
      // Nothing more to show than what is already on screen.
    }
    lost(stale)
  }
}

// Keeping in step with an agent, another window or the web app. Queued
// behind any save in flight so it never overwrites a change not yet sent.
export function refresh() {
  pending = pending.then(async () => {
    try {
      await reload()
      set({ info: await loadInfo() })
    } catch {
      // Offline for a moment; the next check will try again.
    }
  })
}
