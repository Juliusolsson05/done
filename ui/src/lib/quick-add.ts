// Reading a typed line: "call the bank tomorrow p1 #home".
import { findDate, type Dismissed, type Phrase } from '@/lib/date-phrases'
import type { Day } from '@/lib/days'
import type { Project } from '@/lib/tasks'

export const tagOf = (name: string): string => name.toLowerCase().replace(/\s+/g, '-')

export interface Parsed {
  title: string
  due: Day | null
  // Where the date was written, for showing it in the field.
  date: Phrase | null
  priority: number | null
  projectId: number | null
}

// The line without its date phrase. Punctuation that leaned on the phrase
// stays with the words before it ("call Anna today." is "call Anna.") and
// goes when there are none ("today, call Anna" is "call Anna").
function without(text: string, phrase: Phrase): string {
  const before = text.slice(0, phrase.start).trimEnd()
  const after = text.slice(phrase.end)
  if (!before) return after.replace(/^[.,;:!?]+/, '')
  return before + (/^[.,;:!?]/.test(after) ? '' : ' ') + after
}

// The date is the last date phrase in the line that was not dismissed (see
// date-phrases.ts). Only the first priority and the first known #project are
// taken out as well; everything else stays in the title as typed.
export function parseQuickAdd(text: string, projects: Project[], today: Day, dismissed: Dismissed[] = []): Parsed {
  const date = findDate(text, today, dismissed)
  const kept: string[] = []
  let priority: number | null = null
  let projectId: number | null = null
  for (const word of (date ? without(text, date) : text).trim().split(/\s+/).filter(Boolean)) {
    const w = word.toLowerCase()
    const p: RegExpExecArray | null = priority === null ? /^p([1-4])$/.exec(w) : null
    if (p) {
      priority = Number(p[1])
      continue
    }
    if (projectId === null && w.length > 1 && w[0] === '#') {
      const tag = w.slice(1)
      const match = projects.find((x) => tagOf(x.name) === tag) ?? projects.find((x) => tagOf(x.name).startsWith(tag))
      if (match) {
        projectId = match.id
        continue
      }
    }
    kept.push(word)
  }
  return { title: kept.join(' '), due: date?.day ?? null, date, priority, projectId }
}

export interface Read {
  title: string
  due: Day | null
  // The typed date phrase, if `due` came from one rather than from the view.
  date: Phrase | null
  priority: number
  projectId: number | null
}

// What a new task gets when the typed line does not say comes from the view
// you are in (`fallback`). A typed date wins over the view's day because the
// user wrote it; a dismissed one is not a date, so the view's day applies.
export function readLine(
  text: string,
  projects: Project[],
  today: Day,
  fallback: { due: Day | null; projectId: number | null },
  dismissed: Dismissed[] = [],
): Read {
  const p = parseQuickAdd(text, projects, today, dismissed)
  return { title: p.title, due: p.due ?? fallback.due, date: p.date, priority: p.priority ?? 4, projectId: p.projectId ?? fallback.projectId }
}
