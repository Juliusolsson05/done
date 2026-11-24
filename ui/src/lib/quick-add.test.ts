import { describe, expect, it } from 'vitest'
import { parseQuickAdd, peopleSpans, prioritySpan, projectSpan, readLine, suggestPeople, suggestProjects, takePerson, takeSuggestion, type Person } from '@/lib/quick-add'

// 13 November 2026 is a Friday.
const today = '2026-11-13'
const projects = [
  { id: 7, name: 'Home', color: 0 },
  { id: 8, name: 'Side Project', color: 1 },
]
const parse = (text: string) => parseQuickAdd(text, projects, today)

describe('parseQuickAdd', () => {
  it('reads the date, priority and project out of the line', () => {
    expect(parse('call the bank tomorrow p1 #home')).toEqual({
      title: 'call the bank',
      due: '2026-11-14',
      date: { start: 14, end: 22, day: '2026-11-14' },
      priority: 1,
      projectId: 7,
      assignees: [],
    })
  })

  it('leaves short words that are ordinary words and names in the title', () => {
    expect(parse('sat down with Tom in the sun')).toEqual({
      title: 'sat down with Tom in the sun',
      due: null,
      date: null,
      priority: null,
      projectId: null,
      assignees: [],
    })
  })

  it('reads the short weekdays that are not ordinary words', () => {
    expect(parse('gym mon').due).toBe('2026-11-16')
    expect(parse('gym thurs').due).toBe('2026-11-19')
  })

  it('takes a weekday named on that weekday to mean next week', () => {
    expect(parse('review friday').due).toBe('2026-11-20')
    expect(parse('review fri').due).toBe('2026-11-20')
  })

  it('drops the "on" or "by" in front of a date, and only there', () => {
    expect(parse('send invoice by Monday')).toMatchObject({ title: 'send invoice', due: '2026-11-16' })
    expect(parse('carry on today')).toMatchObject({ title: 'carry', due: today })
    expect(parse('stand by the door')).toMatchObject({ title: 'stand by the door', due: null })
  })

  // Until dates could be several words the first date word won. Now the last
  // phrase does, as in Todoist; the first priority still wins.
  it('takes the last date in the line, and keeps an earlier date and a second priority in the title', () => {
    expect(parse('plan today for tomorrow p2 p3')).toMatchObject({ title: 'plan today for p3', due: '2026-11-14', priority: 2, projectId: null })
  })

  it('reads a date of several words together with a priority and a project', () => {
    expect(parse('call the bank next friday p1 #home')).toMatchObject({ title: 'call the bank', due: '2026-11-20', priority: 1, projectId: 7 })
    expect(parse('p2 in 3 days water plants')).toMatchObject({ title: 'water plants', due: '2026-11-16', priority: 2 })
  })

  it('takes the date out of the middle of the title and closes the gap', () => {
    expect(parse('call bank tomorrow about loan')).toMatchObject({ title: 'call bank about loan', due: '2026-11-14' })
    expect(parse('  call   bank  in 2 weeks   about loan ')).toMatchObject({ title: 'call bank about loan', due: '2026-11-27' })
  })

  it('takes an "on", "by" or "due" out with the date it leads', () => {
    expect(parse('pay rent by friday')).toMatchObject({ title: 'pay rent', due: '2026-11-20' })
    expect(parse('pay rent due the 5th of january')).toMatchObject({ title: 'pay rent', due: '2027-01-05' })
    expect(parse('lunch on 24/12 with Anna')).toMatchObject({ title: 'lunch with Anna', due: '2026-12-24' })
  })

  it('leaves punctuation with the words it followed', () => {
    expect(parse('call Anna today.')).toMatchObject({ title: 'call Anna.', due: today })
    expect(parse('today, call Anna')).toMatchObject({ title: 'call Anna', due: today })
  })

  it('takes a year written after a month and day out with it', () => {
    expect(parse('renew passport jan 5 2027 p2')).toMatchObject({ title: 'renew passport', due: '2027-01-05', priority: 2 })
    expect(parse('renew passport 5th of january, 2028')).toMatchObject({ title: 'renew passport', due: '2028-01-05' })
    expect(parse('order jan 5 300 units')).toMatchObject({ title: 'order 300 units', due: '2027-01-05' })
  })

  it('removes brackets or quotes left empty by the date, and no others', () => {
    expect(parse('call Anna (tomorrow)')).toMatchObject({ title: 'call Anna', due: '2026-11-14' })
    expect(parse('call Anna [by friday] p1')).toMatchObject({ title: 'call Anna', due: '2026-11-20', priority: 1 })
    expect(parse('call Anna "tomorrow" about it')).toMatchObject({ title: 'call Anna about it', due: '2026-11-14' })
    expect(parse('(tomorrow) call Anna')).toMatchObject({ title: 'call Anna', due: '2026-11-14' })
    expect(parse('call Anna (tomorrow morning)')).toMatchObject({ title: 'call Anna (morning)', due: '2026-11-14' })
    expect(parse('call Anna (early tomorrow)')).toMatchObject({ title: 'call Anna (early)', due: '2026-11-14' })
    expect(parse('say "hi" tomorrow to Anna')).toMatchObject({ title: 'say "hi" to Anna', due: '2026-11-14' })
    expect(parse('call Anna () tomorrow')).toMatchObject({ title: 'call Anna ()', due: '2026-11-14' })
  })

  it('has no title when the line is only a date, so nothing is added', () => {
    expect(parse('tomorrow')).toMatchObject({ title: '', due: '2026-11-14' })
    expect(parse('by next friday p1')).toMatchObject({ title: '', due: '2026-11-20', priority: 1 })
  })

  it('keeps a dismissed date in the title and sets no date from it', () => {
    const dismissed = [{ start: 14, end: 22, words: 'tomorrow' }]
    expect(parseQuickAdd('call the bank tomorrow p1', projects, today, dismissed)).toEqual({
      title: 'call the bank tomorrow',
      due: null,
      date: null,
      priority: 1,
      projectId: null,
      assignees: [],
    })
    // Dismissed alone, the word is a title.
    expect(parseQuickAdd('tomorrow', projects, today, [{ start: 0, end: 8, words: 'tomorrow' }])).toMatchObject({ title: 'tomorrow', due: null })
  })

  it('only reads p1 to p4 as a priority', () => {
    expect(parse('buy p5 paper')).toMatchObject({ title: 'buy p5 paper', priority: null })
  })

  it('matches a project by its tag or the start of it, and leaves unknown tags alone', () => {
    expect(parse('ship it #side-project').projectId).toBe(8)
    expect(parse('ship it #side').projectId).toBe(8)
    expect(parse('ship it #work')).toMatchObject({ title: 'ship it #work', projectId: null })
    expect(parse('issue # 4')).toMatchObject({ title: 'issue # 4', projectId: null })
  })
})

describe('readLine', () => {
  it('falls back to the view for what the line does not say', () => {
    const fallback = { due: today, projectId: 8 }
    expect(readLine('water plants', projects, today, fallback)).toEqual({
      title: 'water plants',
      due: today,
      date: null,
      priority: 4,
      projectId: 8,
      assignees: [],
    })
    expect(readLine('water plants tomorrow #home', projects, today, fallback)).toMatchObject({ due: '2026-11-14', projectId: 7 })
  })

  it('lets a typed date win over the day the view gives, and says it was typed', () => {
    const inToday = { due: today, projectId: null }
    expect(readLine('water plants next friday', projects, today, inToday)).toMatchObject({
      title: 'water plants',
      due: '2026-11-20',
      date: { start: 13, end: 24, day: '2026-11-20' },
    })
  })

  it('goes back to the day the view gives when the typed date is dismissed', () => {
    const inToday = { due: today, projectId: null }
    const dismissed = [{ start: 13, end: 24, words: 'next friday' }]
    expect(readLine('water plants next friday', projects, today, inToday, dismissed)).toMatchObject({
      title: 'water plants next friday',
      due: today,
      date: null,
    })
    expect(readLine('water plants next friday', projects, today, { due: null, projectId: null }, dismissed).due).toBeNull()
  })
})

describe('projects written with @', () => {
  it('reads @project like #project and takes it out of the title', () => {
    expect(parse('fix 2 UI issues @home')).toMatchObject({ title: 'fix 2 UI issues', projectId: 7 })
    expect(parse('ship it @side')).toMatchObject({ title: 'ship it', projectId: 8 })
  })
  it('leaves an email address and an unknown @ alone', () => {
    expect(parse('mail bob@home.com')).toMatchObject({ title: 'mail bob@home.com', projectId: null })
    expect(parse('ping @nobody')).toMatchObject({ title: 'ping @nobody', projectId: null })
  })
  it('says where the project was written', () => {
    expect(projectSpan('fix it @home today', projects)).toEqual({ start: 7, end: 12 })
    expect(projectSpan('a@home', projects)).toBeNull()
  })
})

describe('suggesting a project', () => {
  it('offers every project for a bare @, and the matching ones as more is typed', () => {
    expect(suggestProjects('fix it @', 8, projects)?.projects.map((p) => p.id)).toEqual(projects.map((p) => p.id))
    expect(suggestProjects('fix it @si', 10, projects)).toMatchObject({ start: 7, end: 10, projects: [{ id: 8 }] })
  })
  it('offers nothing once the tag is whole, or outside an @ word', () => {
    expect(suggestProjects('fix it @home', 12, projects)).toBeNull()
    expect(suggestProjects('fix it', 6, projects)).toBeNull()
    expect(suggestProjects('mail bob@ho', 11, projects)).toBeNull()
  })
  it('completes the word with Tab', () => {
    const s = suggestProjects('fix it @si now', 10, projects)!
    expect(takeSuggestion('fix it @si now', s, s.projects[0])).toEqual({ text: 'fix it @side-project now', caret: 21 })
  })
})

// Hop's members, as quick add gets them for a task going into Hop.
const hop: Person[] = [
  { id: '1001', handle: 'julius', name: 'Julius Olsson' },
  { id: '1002', handle: 'geart', name: 'Geart' },
]

describe('+name', () => {
  it('puts the people named on the task and takes them out of the title', () => {
    expect(parseQuickAdd('ship the deck +geart +jul friday', projects, today, [], hop)).toMatchObject({
      title: 'ship the deck',
      assignees: ['1002', '1001'],
      due: '2026-11-20',
    })
    // Named twice is once; someone not in the workspace stays in the title.
    expect(parseQuickAdd('review +geart +geart +ana', projects, today, [], hop)).toMatchObject({ title: 'review +ana', assignees: ['1002'] })
    // A "+" that names nobody is just text.
    expect(parseQuickAdd('+1 for the idea', projects, today, [], hop)).toMatchObject({ title: '+1 for the idea', assignees: [] })
    // Without a workspace there is nobody to name.
    expect(parse('call +geart')).toMatchObject({ title: 'call +geart', assignees: [] })
  })

  it('asks who can be named for the project the task goes into', () => {
    const asked: (number | null)[] = []
    const peopleFor = (id: number | null) => (asked.push(id), id === 8 ? hop : [])
    expect(readLine('ship +geart #side', projects, today, { due: null, projectId: null }, [], peopleFor)).toMatchObject({
      title: 'ship',
      projectId: 8,
      assignees: ['1002'],
    })
    // In the view of another project, the view's project decides.
    expect(readLine('ship +geart', projects, today, { due: null, projectId: 7 }, [], peopleFor)).toMatchObject({ title: 'ship +geart', assignees: [] })
    expect(asked).toEqual([8, 7])
  })

  it('suggests people while "+" is typed and marks the names read', () => {
    expect(suggestPeople('call +', 6, hop)?.people.map((p) => p.id)).toEqual(['1001', '1002'])
    expect(suggestPeople('call +ge', 8, hop)).toEqual({ start: 5, end: 8, people: [hop[1]] })
    expect(suggestPeople('call +geart', 11, hop)).toBeNull()
    expect(suggestPeople('a+b', 3, hop)).toBeNull()
    const s = suggestPeople('call +ge now', 8, hop)!
    expect(takePerson('call +ge now', s, hop[1])).toEqual({ text: 'call +geart now', caret: 12 })
    expect(peopleSpans('call +geart and +nobody', hop)).toEqual([{ start: 5, end: 11 }])
  })
})

// 24 Nov: "p1" was taken as the priority but not marked in the field, where
// the date and the project are.
describe('prioritySpan', () => {
  it('marks the first standalone p1 to p4', () => {
    const text = 'Call the bank tomorrow p1 @hop'
    expect(prioritySpan(text)).toEqual({ start: 23, end: 25 })
    expect(prioritySpan('P3 fix it')).toEqual({ start: 0, end: 2 })
  })
  it('leaves words that only contain p1, and p5, alone', () => {
    expect(prioritySpan('top1 sap1 p5 p12')).toBeNull()
  })
  it('skips one inside the date phrase', () => {
    expect(prioritySpan('x p1 y p2', { start: 2, end: 4 })).toEqual({ start: 7, end: 9 })
  })
})
