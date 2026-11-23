// What the Workspaces settings, the move dialog and the bell say. Plain data
// in, words out; the components only draw them.
import type { Data } from '@/lib/tasks'
import { firstName, isPersonal, namesOf, workspaceOf, type Member, type Notice, type Team } from '@/lib/team'

// Invites first (they wait for an answer), then the rest; newest first in each.
export function sortNotices(notices: Notice[]): Notice[] {
  return [...notices].sort((a, b) => Number(b.kind === 'invite') - Number(a.kind === 'invite') || b.created - a.created)
}

// "Just now", "5 minutes ago", "2 hours ago", "Yesterday", "3 days ago", or a date.
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// Who did it, by first name; "Someone" when the server does not know any more.
export const byName = (n: Notice): string => firstName(n.by.name) || 'Someone'

// The sentence a notification is, in parts, so the names can be set in bold.
export function noticeParts(n: Notice): { who: string; did: string; what: string } {
  if (n.kind === 'invite') return { who: byName(n), did: 'invited you to', what: n.spaceName || 'a workspace' }
  if (n.kind === 'assigned') return { who: byName(n), did: 'assigned you', what: n.taskTitle || 'a task' }
  return { who: byName(n), did: 'joined', what: n.spaceName || 'your workspace' }
}

// The small line under it: when, and where.
export function noticeDetail(n: Notice, now: number): string {
  const when = ago(n.created, now)
  if (n.kind === 'invite') return n.members ? `${when} · ${n.members} ${n.members === 1 ? 'member' : 'members'}` : when
  if (n.kind === 'assigned' && n.spaceName) return `${when} · ${n.spaceName}`
  return when
}

// A Google address, near enough: the server checks it properly.
export const looksLikeEmail = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())

// Your own projects, which are the ones you can move into a workspace.
export const ownProjects = (data: Pick<Data, 'projects'>, team: Team | null | undefined) => data.projects.filter((p) => isPersonal(p.spaceId, team))

export const openTaskCount = (data: Pick<Data, 'tasks'>, project: number): number =>
  data.tasks.filter((t) => t.projectId === project && t.parentId == null && !t.done).length

export interface MoveWords {
  title: string
  body: string
  // Whose faces to show beside it: who gains it, or who loses it.
  people: Member[]
  action: string
}

// What moving a project says before it happens: who will see it, or who
// will no longer see it.
export function moveWords(data: Pick<Data, 'projects' | 'tasks'>, team: Team, project: number, to: number, me: string): MoveWords | null {
  const p = data.projects.find((x) => x.id === project)
  if (!p) return null
  const count = openTaskCount(data, project)
  const tasks = count === 1 ? '1 open task' : `${count} open tasks`
  const target = workspaceOf(to, team)
  const source = workspaceOf(p.spaceId, team)
  if (target) {
    const others = target.members.filter((m) => m.id !== me)
    const who = others.length ? namesOf(others.map((m) => firstName(m.name) || m.email)) : 'Everyone you invite'
    return {
      title: `Move “${p.name}” to ${target.name}?`,
      body: `${who} will see and change it, with its ${tasks} and its notes. Your time sheet stays yours.`,
      people: target.members,
      action: `Move to ${target.name}`,
    }
  }
  const leaving = (source?.members ?? []).filter((m) => m.id !== me)
  const who = leaving.length ? namesOf(leaving.map((m) => firstName(m.name) || m.email)) : 'Nobody else'
  return {
    title: `Move “${p.name}” to your own space?`,
    body: `${who} ${leaving.length === 1 ? 'loses' : 'lose'} access to it, its ${tasks} and its notes. Anyone assigned is taken off. You can move it back any time.`,
    people: leaving,
    action: 'Move to my space',
  }
}
