// Reading a typed line: "call the bank tomorrow p1 #home".
import { addDays, nextWeekday, type Day } from '@/lib/days'
import type { Project } from '@/lib/tasks'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// "sat", "sun" and "tom" are left out on purpose: they are ordinary words and names.
const SHORT: Record<string, number> = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5 }

function dayWord(w: string, today: Day): Day | null {
  if (w === 'today' || w === 'tod') return today
  if (w === 'tomorrow' || w === 'tmr') return addDays(today, 1)
  const target = WEEKDAYS.includes(w) ? WEEKDAYS.indexOf(w) : SHORT[w]
  if (target === undefined) return null
  return nextWeekday(today, target)
}

export const tagOf = (name: string): string => name.toLowerCase().replace(/\s+/g, '-')

export interface Parsed {
  title: string
  due: Day | null
  priority: number | null
  projectId: number | null
}

// Only the first date word, the first priority and the first known #project
// are taken out of the line; everything else stays in the title as typed.
export function parseQuickAdd(text: string, projects: Project[], today: Day): Parsed {
  const kept: string[] = []
  let due: Day | null = null
  let priority: number | null = null
  let projectId: number | null = null
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const w = word.toLowerCase()
    const day = due === null ? dayWord(w, today) : null
    if (day) {
      due = day
      if (['on', 'by'].includes((kept.at(-1) ?? '').toLowerCase())) kept.pop()
      continue
    }
    const p = priority === null ? /^p([1-4])$/.exec(w) : null
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
  return { title: kept.join(' '), due, priority, projectId }
}

export interface Read {
  title: string
  due: Day | null
  priority: number
  projectId: number | null
}

// What a new task gets when the typed line does not say comes from the view
// you are in (`fallback`).
export function readLine(
  text: string,
  projects: Project[],
  today: Day,
  fallback: { due: Day | null; projectId: number | null },
): Read {
  const p = parseQuickAdd(text, projects, today)
  return { title: p.title, due: p.due ?? fallback.due, priority: p.priority ?? 4, projectId: p.projectId ?? fallback.projectId }
}
