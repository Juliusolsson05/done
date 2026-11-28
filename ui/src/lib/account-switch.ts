// What the app says and does when its account changes: signing out with
// changes not sent yet, signing in where another account's tasks still are,
// and the focus session on a workspace task that leaves with the account.
// The rules for the file itself are in crates/core/src/account.rs.
import type { Session } from '@/lib/focus'
import type { Task } from '@/lib/tasks'
import { isPersonal, workspaces, type Team } from '@/lib/team'

// The file holds another account's tasks, so nothing was sent (core `Held`).
export interface Held {
  account: { id?: string; email: string }
  rows: number
  unsent: number
}

// What leaving did when a window loaded (core `Left`): 'ended' is a session
// that ran out or was ended by the server; `kept` changes wait for it.
export interface Left {
  how: 'ended' | 'signed-out' | 'deleted'
  removed: number
  kept: number
}

// What a round would send, as the app's `outbox` gives it.
export interface Pending {
  rows: Partial<Record<'projects' | 'tasks' | 'notes' | 'entries' | 'assignees' | 'gone', unknown[]>>
  held?: Held | null
}

// How many changes have not reached the account. Another account's are not
// counted: signing out leaves them on this device as they are.
export function unsentCount(outbox: Pending): number {
  if (outbox.held) return 0
  return Object.values(outbox.rows).reduce((n, list) => n + (list?.length ?? 0), 0)
}

const changes = (n: number) => (n === 1 ? '1 change' : `${n} changes`)

const are = (n: number) => (n === 1 ? 'is' : 'are')

// Said once when the window loads after the session ended.
export function endedMessage(left: Left | null): string | null {
  if (left?.how !== 'ended') return null
  if (left.kept === 0) return 'Your session ended. Sign in to sync again.'
  return `Your session ended. ${changes(left.kept)} ${are(left.kept)} waiting on this device. Sign in to send ${left.kept === 1 ? 'it' : 'them'}.`
}

// Shown where one signs in, while changes wait for an account.
export function waitingMessage(held: Held | null): string | null {
  if (!held || held.unsent === 0) return null
  const who = held.account.email || 'your account'
  return `${changes(held.unsent)} from ${who} ${are(held.unsent)} waiting on this device. Sign in as ${who} to send ${held.unsent === 1 ? 'it' : 'them'}.`
}

// Said with the question before deleting the account.
export function deletionWarning(unsent: number): string | null {
  if (unsent === 0) return null
  return `${changes(unsent)} not sent yet. Your own stay on this device; changes in shared workspaces are lost.`
}

export function signOutQuestion(unsent: number): string {
  return `${changes(unsent)} not sent yet. Sign out anyway? Your own stay on this device and go up when you sign in again. Changes in shared workspaces are lost.`
}

export interface HeldMessage {
  title: string
  body: string
  // The button that takes the other account's tasks off this device.
  drop: string
}

export function heldMessage(held: Held): HeldMessage {
  const who = held.account.email || 'your other account'
  if (held.unsent > 0) {
    return {
      title: 'Changes from another account',
      body: `${changes(held.unsent)} from ${who} ${held.unsent === 1 ? 'was' : 'were'} never sent. Sign in as ${who} to send them, or remove them from this device.`,
      drop: 'Remove them',
    }
  }
  return {
    title: 'Tasks from another account',
    // Not "they are in that account": it may have been deleted since.
    body: `This device has tasks from ${who} that were synced with that account. Take them off this device to use this account here?`,
    drop: 'Continue',
  }
}

// A focus session on a workspace task ends before signing out: its title
// would stay in the Dynamic Island and the menu bar after the task has left
// the device. One on a task that is not loaded is ended too when there are
// workspaces, as it may be one of theirs.
export function focusLeaves(session: Session | null, tasks: Task[], team: Team | null | undefined): boolean {
  if (!session || session.taskId === null || !team) return false
  const task = tasks.find((t) => t.id === session.taskId)
  return task ? !isPersonal(task.spaceId, team) : workspaces(team).length > 0
}
