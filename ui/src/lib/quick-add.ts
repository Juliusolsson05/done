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
  // Account ids named with "+name", in the order typed, once each.
  assignees: string[]
}

// Someone a task can be given to with "+name": a member of the workspace the
// task goes into. `handle` is what is typed (see lib/team.ts handleOf).
export interface Person {
  id: string
  handle: string
  name: string
}

// "+geart": the person whose handle is this or starts with it.
function personOfWord(word: string, people: Person[]): Person | undefined {
  if (word.length < 2 || word[0] !== '+') return undefined
  const typed = word.slice(1).toLowerCase()
  return people.find((p) => p.handle === typed) ?? people.find((p) => p.handle.startsWith(typed))
}

// Where in the line each "+name" naming someone was written, for marking.
export function peopleSpans(text: string, people: Person[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  for (const m of text.matchAll(/\+\S+/g)) {
    if (m.index > 0 && !/\s/.test(text[m.index - 1])) continue
    if (personOfWord(m[0], people)) spans.push({ start: m.index, end: m.index + m[0].length })
  }
  return spans
}

export interface PeopleSuggestion {
  start: number
  end: number
  people: Person[]
}

// While a word starting with "+" is being typed: who it could be. Everyone
// for a bare "+"; none once it is a whole handle.
export function suggestPeople(text: string, caret: number, people: Person[]): PeopleSuggestion | null {
  const m = /(?:^|\s)\+(\S*)$/.exec(text.slice(0, caret))
  if (!m || /^\S/.test(text.slice(caret)) || !people.length) return null
  const typed = m[1].toLowerCase()
  if (people.some((p) => p.handle === typed)) return null
  const found = people.filter((p) => p.handle.startsWith(typed))
  if (!found.length) return null
  return { start: caret - typed.length - 1, end: caret, people: found }
}

export function takePerson(text: string, suggestion: PeopleSuggestion, person: Person): { text: string; caret: number } {
  const word = '+' + person.handle + ' '
  const after = text.slice(suggestion.end).replace(/^ /, '')
  return { text: text.slice(0, suggestion.start) + word + after, caret: suggestion.start + word.length }
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

// Where in the line the priority was written ("p0" to "p4"), for marking it
// in the field as the date and the project are (Julius, 24 Nov: "p1 is blue
// like other references"). The first one only, as parseQuickAdd takes only
// the first; one inside the date phrase is not a priority.
export function prioritySpan(text: string, date?: { start: number; end: number } | null): { start: number; end: number } | null {
  for (const m of text.matchAll(/(?<=^|\s)p[0-4](?=\s|$)/gi)) {
    if (date && m.index >= date.start && m.index < date.end) continue
    return { start: m.index, end: m.index + m[0].length }
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
// Every "+name" that names someone in `people` comes out of the title too;
// one that names nobody stays as typed ("+1 for the idea").
export function parseQuickAdd(text: string, projects: Project[], today: Day, dismissed: Dismissed[] = [], people: Person[] = []): Parsed {
  const date = findDate(text, today, dismissed)
  const kept: string[] = []
  let priority: number | null = null
  let projectId: number | null = null
  const assignees: string[] = []
  for (const word of (date ? without(text, date) : text).trim().split(/\s+/).filter(Boolean)) {
    const w = word.toLowerCase()
    const person = personOfWord(w, people)
    if (person) {
      if (!assignees.includes(person.id)) assignees.push(person.id)
      continue
    }
    const p: RegExpExecArray | null = priority === null ? /^p([0-4])$/.exec(w) : null
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
  return { title: kept.join(' '), due: date?.day ?? null, date, priority, projectId, assignees }
}

export interface Read {
  title: string
  due: Day | null
  // The typed date phrase, if `due` came from one rather than from the view.
  date: Phrase | null
  priority: number
  projectId: number | null
  assignees: string[]
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
  // Who "+name" can name, for the project the task will be in: the members
  // of its workspace, or nobody for one's own.
  peopleFor: (projectId: number | null) => Person[] = () => [],
): Read {
  const first = parseQuickAdd(text, projects, today, dismissed)
  const projectId = first.projectId ?? fallback.projectId
  const people = peopleFor(projectId)
  const p = people.length ? parseQuickAdd(text, projects, today, dismissed, people) : first
  return {
    title: p.title,
    due: p.due ?? fallback.due,
    date: p.date,
    priority: p.priority ?? fallback.priority ?? 4,
    projectId,
    assignees: p.assignees,
  }
}
