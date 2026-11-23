// Tasks mentioned in a note. A mention is an ordinary Markdown link whose
// address is done:task/<id>, such as [Call the bank](done:task/1795306779859023).
//
// Why a plain link and not a syntax of our own: the Markdown parser already
// finds links (and already leaves them alone inside code), so reading a note
// needs no second pass over its text; only the drawing of that one link
// element changes. Mixing a custom parser with Markdown rendering is what has
// gone wrong before. The text also stays readable everywhere a note goes: the
// editor, older versions of the app, other devices, an AI agent over MCP.
import { describeDay, type Day } from '@/lib/days'
import { byPriority, openTasks, type Task } from '@/lib/tasks'

const SCHEME = 'done:task/'

export const mentionHref = (id: number): string => SCHEME + id

// The task a link points at, or null for any other link. Only the exact form
// counts, so a web link, or anything else that merely starts the same way,
// keeps being a plain link.
export function mentionId(href: string | undefined): number | null {
  const match = href ? /^done:task\/(\d{1,20})$/.exec(href) : null
  return match ? Number(match[1]) : null
}

// A Markdown link label cannot hold an unescaped bracket or backslash.
const escapeLabel = (title: string): string =>
  title
    .replace(/[\\[\]]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim()
const unescapeLabel = (label: string): string => label.replace(/\\([\\[\]])/g, '$1')

export const mentionLink = (task: Pick<Task, 'id' | 'title'>): string => `[${escapeLabel(task.title)}](${mentionHref(task.id)})`

// A mention as it is written: the label (escaped brackets allowed) and the id.
const MENTION = /\[((?:\\.|[^\]\\\n])*)\]\(done:task\/(\d{1,20})\)/g

// Code is shown as written, so a mention inside it is text, not a task: the
// same rule the Markdown parser follows when it draws the note.
// Fences may be indented (inside a list item, say), and a code span may use
// more than one backtick (``a `b` c``).
const withoutCode = (text: string): string =>
  text.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(^[ \t]*\1[^\n]*$|(?![\s\S]))/gm, '').replace(/(`+)[^\n]*?\1/g, '')

// The tasks a note mentions, in the order they first appear, once each.
export function mentionsIn(text: string): number[] {
  const ids: number[] = []
  for (const match of withoutCode(text).matchAll(MENTION)) {
    const id = Number(match[2])
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

// Where each mention is in the text, for the editor to draw it as one piece
// ("@Call the bank") that the cursor steps over and Backspace takes whole:
// half a link would leave text that is neither a mention nor readable.
export function mentionRanges(text: string): { from: number; to: number; id: number; label: string }[] {
  const ranges: { from: number; to: number; id: number; label: string }[] = []
  for (const match of text.matchAll(MENTION)) {
    ranges.push({ from: match.index, to: match.index + match[0].length, id: Number(match[2]), label: unescapeLabel(match[1]) })
  }
  return ranges
}

// A mention read as its words alone, for a note's title in the list: "Call
// the bank" rather than the link around it.
export const withoutMentionSyntax = (text: string): string => text.replace(MENTION, (_, label: string) => unescapeLabel(label))

// The @ being typed just before the caret, if any: where it starts and what
// follows it. Only at the start of a line or after a space or an opening
// bracket, so the @ in name@mail.com never asks for a task. The words after
// it may hold spaces (task titles do), but not a line break or brackets.
export function atQuery(text: string, caret: number): { start: number; query: string } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const line = text.slice(lineStart, caret)
  const match = /(?:^|[\s([])@([^\s@[\]()](?:[^@[\]()\n]{0,40})?)?$/.exec(line)
  if (!match) return null
  const query = match[1] ?? ''
  // Two spaces in a row mean the writing has moved on.
  if (/\s{2}/.test(query)) return null
  // A task is found within a few words; past that, it is a sentence being
  // written, not a task being asked for.
  if (query.split(' ').length > 4) return null
  return { start: lineStart + line.length - query.length - 1, query }
}

// The note with the @ being typed (from `start` to the caret) replaced by a
// mention, and where the caret goes after it: past one space.
export function insertMention(text: string, start: number, caret: number, task: Pick<Task, 'id' | 'title'>): { text: string; caret: number } {
  const link = mentionLink(task)
  const after = text.slice(caret)
  const space = after.startsWith(' ') || after.startsWith('\n') ? '' : ' '
  const next = text.slice(0, start) + link + space + after
  // Past the space added, or right after the link when the line ends there,
  // so the caret never jumps to the next line.
  return { text: next, caret: start + link.length + space.length }
}

// The open tasks that fit what has been typed after the @: a title that
// starts with it first, then one with a word that does, then any that holds
// every word; within each, by priority. Nothing typed yet: the soonest due.
export function suggestions(tasks: Task[], query: string, limit = 8): Task[] {
  const open = openTasks(tasks)
  const q = query.trim().toLowerCase()
  if (!q) {
    const soon = (t: Task) => t.due ?? '9999'
    return [...open].sort((a, b) => soon(a).localeCompare(soon(b)) || byPriority(a, b)).slice(0, limit)
  }
  const words = q.split(/\s+/)
  const rank = (t: Task): number => {
    const title = t.title.toLowerCase()
    if (title.startsWith(q)) return 0
    if (title.split(/\s+/).some((w) => w.startsWith(words[0]))) return 1
    return 2
  }
  return open
    .filter((t) => words.every((w) => t.title.toLowerCase().includes(w)))
    .sort((a, b) => rank(a) - rank(b) || byPriority(a, b))
    .slice(0, limit)
}

// What a mentioned task's card says under its title, in order: where it
// lives, when it is due (or when it was done), how far its subtasks are, and
// whether it is under way. Each part only when it has something to say. Its
// description is shown whole, under these (see the card).
export type Detail =
  | { kind: 'project'; id: number | null; name: string }
  | { kind: 'when'; text: string; late: boolean }
  | { kind: 'subtasks'; done: number; total: number }
  | { kind: 'doing' }

export function mentionDetails(task: Task, tasks: Task[], projects: { id: number; name: string }[], today: Day): Detail[] {
  const details: Detail[] = [{ kind: 'project', id: task.projectId, name: projects.find((p) => p.id === task.projectId)?.name ?? 'Inbox' }]
  if (task.done) {
    if (task.doneDay) details.push({ kind: 'when', text: 'Done ' + describeDay(task.doneDay, today).toLowerCase(), late: false })
  } else if (task.due) {
    const late = task.due < today
    const due = describeDay(task.due, today)
    const start = task.start && task.start !== task.due ? describeDay(task.start, today) + ' – ' : ''
    details.push({ kind: 'when', text: late ? `Late · ${due}` : start + due, late })
  }
  const under = tasks.filter((t) => t.parentId === task.id)
  if (under.length) details.push({ kind: 'subtasks', done: under.filter((t) => t.done).length, total: under.length })
  if (!task.done && task.status === 'doing') details.push({ kind: 'doing' })
  return details
}
