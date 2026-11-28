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
    body: `This device has tasks from ${who}. They are in that account. Take them off this device to use this account here?`,
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
