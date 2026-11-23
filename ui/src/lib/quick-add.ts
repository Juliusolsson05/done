// Reading a typed line: "call the bank tomorrow p1 @home" (or #home).
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

const CLOSES: Record<string, string> = { '(': ')', '[': ']', '"': '"', "'": "'" }

// The line without its date phrase. Punctuation that leaned on the phrase
// stays with the words before it ("call Anna today." is "call Anna.") and
// goes when there are none ("today, call Anna" is "call Anna"). Brackets or
// quotes that held only the phrase go with it ("call Anna (tomorrow)" is
// "call Anna"); a pair that still holds something is left alone.
function without(text: string, phrase: Phrase): string {
  let before = text.slice(0, phrase.start)
  let after = text.slice(phrase.end)
  const opened = before.at(-1) ?? ''
  if (after !== '' && after[0] === CLOSES[opened]) {
    before = before.slice(0, -1)
    after = after.slice(1)
  }
  before = before.trimEnd()
  if (!before) return after.replace(/^[.,;:!?]+/, '')
  // No gap after an opening bracket: "(tomorrow morning)" is "(morning)".
  if (/[([]$/.test(before)) return before + after.trimStart()
  return before + (/^[.,;:!?)\]]/.test(after) ? '' : ' ') + after
}

// "@hop" or "#hop": the project whose tag is this or starts with it.
function projectOfWord(word: string, projects: Project[]): Project | undefined {
  if (word.length < 2 || (word[0] !== '#' && word[0] !== '@')) return undefined
  const tag = word.slice(1).toLowerCase()
  return projects.find((x) => tagOf(x.name) === tag) ?? projects.find((x) => tagOf(x.name).startsWith(tag))
}

// Where in the line the project was written, for marking it in the field as
// the date is: the first "@word" or "#word" naming a project.
export function projectSpan(text: string, projects: Project[]): { start: number; end: number } | null {
  for (const m of text.matchAll(/[@#]\S+/g)) {
    // Only at the start of a word: an address like a@b.com is not a project.
    if (m.index > 0 && !/\s/.test(text[m.index - 1])) continue
    if (projectOfWord(m[0], projects)) return { start: m.index, end: m.index + m[0].length }
  }
  return null
}

export interface Suggestion {
  // The part of the line Tab replaces: the "@" and what follows it, up to the caret.
  start: number
  end: number
  projects: Project[]
}

// While a word starting with "@" or "#" is being typed, the projects it could
// be: all of them for a bare "@", otherwise those whose tag starts with it.
// None once the word is already a whole tag.
export function suggestProjects(text: string, caret: number, projects: Project[]): Suggestion | null {
  const before = text.slice(0, caret)
  const m = /(?:^|\s)([@#])(\S*)$/.exec(before)
  if (!m || /^\S/.test(text.slice(caret))) return null
  const typed = m[2].toLowerCase()
  if (projects.some((p) => tagOf(p.name) === typed)) return null
  const found = projects.filter((p) => tagOf(p.name).startsWith(typed))
  if (!found.length) return null
  return { start: caret - typed.length - 1, end: caret, projects: found }
}

// The line with the suggestion taken: "@hop " in place of what was typed.
export function takeSuggestion(text: string, suggestion: Suggestion, project: Project): { text: string; caret: number } {
  const word = '@' + tagOf(project.name) + ' '
  const after = text.slice(suggestion.end).replace(/^ /, '')
  return { text: text.slice(0, suggestion.start) + word + after, caret: suggestion.start + word.length }
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
    if (projectId === null) {
      const match = projectOfWord(w, projects)
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
  fallback: { due: Day | null; projectId: number | null; priority?: number | null },
  dismissed: Dismissed[] = [],
): Read {
  const p = parseQuickAdd(text, projects, today, dismissed)
  return {
    title: p.title,
    due: p.due ?? fallback.due,
    date: p.date,
    priority: p.priority ?? fallback.priority ?? 4,
    projectId: p.projectId ?? fallback.projectId,
  }
}
