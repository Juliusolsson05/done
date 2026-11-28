// The tasks and projects this window is showing, and keeping them saved.
// One store for the whole interface; React reads it with useSyncExternalStore.
import type { Held } from '@/lib/account-switch'
import { BROWSER_INFO, canReplicate, loadInfo, loadState, replicate, sync, takeOverHere, type Info } from '@/lib/backend'
import { changeSet, picture, type Picture } from '@/lib/changes'
import { TODAY } from '@/lib/days'
import type { Data } from '@/lib/tasks'
import { recordChange } from '@/lib/undo'

export interface Snapshot {
  data: Data
  info: Info
  // This device holds another account's tasks, so nothing is synced until
  // the person says what to do (components/held-dialog.tsx).
  held: Held | null
}

let snapshot: Snapshot = { data: { rev: 0, nextId: 1, projects: [], tasks: [] }, info: BROWSER_INFO, held: null }
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
    replicateSoon()
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

// Keeping a signed-in app in step with its account. Queued with the saves,
// like `refresh`: a round never runs while a save is half done, and a save
// made meanwhile waits for it, so nothing typed is overwritten by a reload.
// Something that arrived reloads the window; notes and the time sheet are
// told by an event, as they load on their own.
export const SYNCED = 'done-synced'
let replicating = false
// Off while the account leaves this device (lib/leave.ts): a round that
// started after the clean-up would bring the account's rows back.
let stopped = false
export const stopSyncing = () => {
  stopped = true
}
export const resumeSyncing = () => {
  stopped = false
}
export function replicateNow(): Promise<void> {
  if (!canReplicate || replicating || stopped) return Promise.resolve()
  replicating = true
  const round = pending.then(async () => {
    try {
      const { arrived, held } = await replicate()
      if (JSON.stringify(held) !== JSON.stringify(snapshot.held)) set({ held })
      if (arrived) {
        await reload()
        window.dispatchEvent(new Event(SYNCED))
      }
    } catch {
      // No connection, or the server is down: this device goes on by itself
      // and the next round sends what it missed.
    } finally {
      replicating = false
    }
  })
  pending = round
  return round
}

// The person's answer to "tasks from another account": take them off this
// device, then sync this account. The answer is kept in the file before any
// round (core `take_over`), and the window shows the file again whatever
// the round does, so it never goes on showing the other account's tasks.
export async function takeOver(): Promise<void> {
  await pending
  try {
    await takeOverHere()
  } finally {
    set({ held: null })
    await reload().catch(() => {})
  }
  await replicateNow()
}

// Once every save and round queued so far is done (lib/leave.ts).
export const idle = (): Promise<void> => pending

// A change goes up a moment after it is saved, so a burst of edits (typing a
// title, ticking off three tasks) goes as one round.
let soon: ReturnType<typeof setTimeout> | undefined
export function replicateSoon() {
  if (!canReplicate) return
  clearTimeout(soon)
  soon = setTimeout(() => void replicateNow(), 1500)
}

// After a workspace was made, joined or changed on the server: bring this
// window up to date with it. An app learns it through a sync round, which
// also stores it on the device; a browser by loading again.
export async function caughtUp(): Promise<void> {
  if (canReplicate) {
    // A round is skipped while another is running; wait for that one, then go.
    await pending
    await replicateNow()
  } else {
    refresh()
  }
  await pending
}
