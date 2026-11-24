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
  const match = href ? /^done:task\/(\d{1,20})(?:#inline)?$/.exec(href) : null
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

// A link to another note is the same kind of link with done:note/<id>:
// [Seed round](done:note/1795306779859023). Its own scheme rather than a flag
// on the task one, so everything that reads task mentions (the read view's
// cards, the refs above a note, agents) keeps reading tasks only.
const NOTE_SCHEME = 'done:note/'
const NOTE_LINK = /\[((?:\\.|[^\]\\\n])*)\]\(done:note\/(\d{1,20})\)/g
// Either kind, for what treats both alike: the editor's atoms, a title read
// as words.
const ANY_LINK = /\[((?:\\.|[^\]\\\n])*)\]\(done:(task|note)\/(\d{1,20})\)/g

export const noteLinkHref = (id: number): string => NOTE_SCHEME + id

// The note a link points at, or null for any other link.
export function noteLinkId(href: string | undefined): number | null {
  const match = href ? /^done:note\/(\d{1,20})$/.exec(href) : null
  return match ? Number(match[1]) : null
}

export const noteLink = (note: { id: number; title: string }): string => `[${escapeLabel(note.title)}](${noteLinkHref(note.id)})`

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

// The notes a note links to, in the order they first appear, once each.
export function noteLinksIn(text: string): number[] {
  const ids: number[] = []
  for (const match of withoutCode(text).matchAll(NOTE_LINK)) {
    const id = Number(match[2])
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export interface LinkRange {
  from: number
  to: number
  kind: 'task' | 'note'
  id: number
  label: string
}

// Where each mention or note link is in the text, for the editor to draw it
// as one piece ("@Call the bank") that the cursor steps over and Backspace
// takes whole: half a link would leave text that is neither a link nor readable.
export function mentionRanges(text: string): LinkRange[] {
  const ranges: LinkRange[] = []
  for (const match of text.matchAll(ANY_LINK)) {
    ranges.push({ from: match.index, to: match.index + match[0].length, kind: match[2] as 'task' | 'note', id: Number(match[3]), label: unescapeLabel(match[1]) })
  }
  return ranges
}

// In the read view, a mention alone on its line (a list item or paragraph
// with nothing else, a checkbox or trailing punctuation aside) is drawn as
// the task's full card; one that shares its line with other words is drawn
// small, inside the sentence. Marked here by an #inline on its address,
// which mentionId still reads as the same task. Code is left as written.
const ALONE = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?$/
export function markInline(text: string): string {
  let fenced = false
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      if (fenced || !line.includes('](done:task/')) return line
      const matches = [...line.matchAll(MENTION)]
      const rest = line.replace(MENTION, '').replace(/[\s.,;:!?]+$/, '')
      if (matches.length === 1 && ALONE.test(rest)) return line
      return line.replace(MENTION, (whole) => whole.replace(/\)$/, '#inline)'))
    })
    .join('\n')
}

// A mention or note link read as its words alone, for a note's title in the
// list: "Call the bank" rather than the link around it.
export const withoutMentionSyntax = (text: string): string => text.replace(ANY_LINK, (_, label: string) => unescapeLabel(label))

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
// link (a task's mentionLink or a note's noteLink), and where the caret goes
// after it: past one space.
export function insertMention(text: string, start: number, caret: number, link: string): { text: string; caret: number } {
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

// One row of the @ list: a task to mention or a note to link.
export type Offer = { kind: 'task'; task: Task } | { kind: 'note'; id: number; title: string }

// The notes that fit what has been typed after the @, matched by title as
// tasks are: one that starts with it first, then one with a word that does,
// then any that holds every word; within each, the newest. Nothing typed
// yet: the newest. Never the note being written (a link to itself goes
// nowhere) and never a blank one (it has no title to show).
export function noteSuggestions<N extends { id: number; title: string; updatedAt: number; blank?: boolean }>(
  notes: N[],
  query: string,
  current: number | null,
  limit = 3,
): N[] {
  const candidates = notes.filter((n) => n.id !== current && !n.blank).sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
  const q = query.trim().toLowerCase()
  if (!q) return candidates.slice(0, limit)
  const words = q.split(/\s+/)
  const rank = (n: N): number => {
    const title = n.title.toLowerCase()
    if (title.startsWith(q)) return 0
    if (title.split(/\s+/).some((w) => w.startsWith(words[0]))) return 1
    return 2
  }
  // A stable sort keeps the newest first within each rank.
  return candidates
    .filter((n) => words.every((w) => n.title.toLowerCase().includes(w)))
    .sort((a, b) => rank(a) - rank(b))
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
