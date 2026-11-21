// Search over the whole app: projects, tasks (with their notes and subtasks)
// and notes. Words are matched anywhere, in any order, case and accents ignored.
import { titleOf, type Note } from '@/lib/notes'
import type { Data, Task } from '@/lib/tasks'

// Letters as they are compared: lower case, without accents ("fjord" finds "Fjörd").
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const wordsOf = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean)

// Every word of the query is somewhere in the text. An empty query matches all.
export function matchesQuery(text: string, query: string): boolean {
  const folded = fold(text)
  return wordsOf(query).every((word) => folded.includes(word))
}

export type Hit =
  | { kind: 'project'; id: number; title: string; detail: string }
  | { kind: 'task'; id: number; title: string; detail: string; done: boolean }
  | { kind: 'note'; id: number; title: string; detail: string }

// Up to this many of each kind, so one kind cannot push the others off.
const EACH = 6

// The line that best shows why something matched: the first, other than the
// title, holding one of the words. Empty when only the title matched.
function lineWith(text: string, query: string, title: string): string {
  const words = wordsOf(query)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== title)
  return lines.find((l) => words.some((w) => fold(l).includes(w))) ?? ''
}

// A match in the title comes before one only found further in.
const titleFirst = <T extends { title: string }>(hits: T[], query: string): T[] =>
  [...hits].sort((a, b) => Number(!matchesQuery(a.title, query)) - Number(!matchesQuery(b.title, query)))

export function searchAll(data: Data, notes: Note[], query: string): Hit[] {
  if (wordsOf(query).length === 0) return []
  const projectName = (id: number | null) => data.projects.find((p) => p.id === id)?.name ?? 'Inbox'
  const byId = new Map(data.tasks.map((t) => [t.id, t]))

  const projects: Hit[] = data.projects
    .filter((p) => matchesQuery(p.name, query))
    .slice(0, EACH)
    .map((p) => ({ kind: 'project', id: p.id, title: p.name, detail: 'Project' }))

  // A task is found by its title, its notes, or the titles of its subtasks.
  const subtasksOf = (t: Task) => data.tasks.filter((s) => s.parentId === t.id).map((s) => s.title)
  const taskHits = data.tasks
    .filter((t) => matchesQuery([t.title, t.notes, ...subtasksOf(t)].join('\n'), query))
    .map((t) => {
      const parent = t.parentId != null ? byId.get(t.parentId) : undefined
      const where = parent ? `in ${parent.title}` : projectName(t.projectId)
      const why = lineWith([t.notes, ...subtasksOf(t)].join('\n'), query, t.title)
      return { kind: 'task' as const, id: t.id, title: t.title, detail: why ? `${where} · ${why}` : where, done: !!t.done }
    })
  // Open tasks before finished ones, then title matches first.
  const tasks = [
    ...titleFirst(
      taskHits.filter((t) => !t.done),
      query,
    ),
    ...titleFirst(
      taskHits.filter((t) => t.done),
      query,
    ),
  ].slice(0, EACH)

  const noteHits = notes
    .filter((n) => matchesQuery(n.text, query))
    .map((n) => {
      const title = titleOf(n.text)
      return {
        kind: 'note' as const,
        id: n.id,
        title,
        detail: lineWith(
          n.text,
          query,
          n.text
            .split('\n')
            .find((l) => l.trim())
            ?.trim() ?? '',
        ),
      }
    })
  const noteList = titleFirst(noteHits, query).slice(0, EACH)

  return [...projects, ...tasks, ...noteList]
}
