import { describe, expect, it } from 'vitest'
import { formatRoute, HOME, isOver, parseRoute, stepTo, titleOf, type Entry, type Route } from '@/lib/route'
import type { View } from '@/lib/tasks'

const at = (view: View, task: number | null = null): Route => ({ view, task })
const ID = 1795306779859023

// Every place the app has, with the address it is written as.
const TABLE: [string, Route][] = [
  ['/today', at({ kind: 'today' })],
  ['/inbox', at({ kind: 'inbox' })],
  ['/upcoming', at({ kind: 'upcoming' })],
  ['/assigned', at({ kind: 'mine' })],
  ['/timeline', at({ kind: 'timeline' })],
  ['/board', at({ kind: 'board' })],
  ['/focus', at({ kind: 'focus' })],
  ['/time-sheet', at({ kind: 'timesheet' })],
  ['/completed', at({ kind: 'completed' })],
  ['/notes', at({ kind: 'notes' })],
  [`/notes/${ID}`, at({ kind: 'notes', id: ID })],
  ['/project/7', at({ kind: 'project', id: 7 })],
  ['/settings', at({ kind: 'settings' })],
  ['/settings/workspace/12', at({ kind: 'settings', space: 12 })],
  ['/lists', at({ kind: 'lists' })],
  ['/notifications', at({ kind: 'notifications' })],
  [`/today?task=${ID}`, at({ kind: 'today' }, ID)],
  ['/project/7?task=3', at({ kind: 'project', id: 7 }, 3)],
  ['/board?task=3', at({ kind: 'board' }, 3)],
]

describe('route', () => {
  it.each(TABLE)('%s reads and writes the same', (address, route) => {
    expect(parseRoute(address)).toEqual(route)
    expect(formatRoute(route)).toBe(address)
    expect(parseRoute(formatRoute(route))).toEqual(route)
  })

  it('reads the root as Today, and writes Today as /today', () => {
    expect(parseRoute('/')).toEqual(HOME)
    expect(formatRoute(HOME)).toBe('/today')
  })

  it('reads a whole URL, and leaves out the hash', () => {
    expect(parseRoute('https://thedone.app/upcoming?task=5#x')).toEqual(at({ kind: 'upcoming' }, 5))
    expect(parseRoute('tauri://localhost/board')).toEqual(at({ kind: 'board' }))
    expect(parseRoute('http://tauri.localhost')).toEqual(HOME)
  })

  it('forgives one trailing slash', () => {
    expect(parseRoute('/upcoming/')).toEqual(at({ kind: 'upcoming' }))
    expect(parseRoute('/project/7/')).toEqual(at({ kind: 'project', id: 7 }))
    expect(parseRoute('/upcoming//')).toBeNull()
  })

  it.each([
    ['an unknown path', '/nope'],
    ['an api path', '/api/state'],
    ['a word from Object', '/constructor'],
    ['a word from Object', '/__proto__'],
    ['a project with no id', '/project'],
    ['a project with an empty id', '/project/'],
    ['letters for an id', '/project/abc'],
    ['a negative id', '/project/-1'],
    ['a decimal id', '/project/1.5'],
    ['an id too long', '/project/123456789012345678901'],
    ['an id past what is exact', '/project/99999999999999999'],
    ['an encoded id', '/project/%31%32'],
    ['an encoded word', '/%74oday'],
    ['extra segments', '/project/7/tasks'],
    ['extra segments on a word', '/today/more'],
    ['a note with extra segments', '/notes/1/2'],
    ['a workspace with no id', '/settings/workspace'],
    ['something else under settings', '/settings/account'],
    ['a doubled slash', '//today'],
    ['no leading slash', 'today'],
    ['nothing', ''],
    ['a different case', '/Today'],
  ])('reads %s as no place: %s', (_what, address) => {
    expect(parseRoute(address)).toBeNull()
  })

  it('drops a task that is not an id, and keeps the view', () => {
    expect(parseRoute('/today?task=abc')).toEqual(at({ kind: 'today' }))
    expect(parseRoute('/today?task=')).toEqual(at({ kind: 'today' }))
    expect(parseRoute('/today?task=-3')).toEqual(at({ kind: 'today' }))
    expect(parseRoute('/today?other=1&task=4')).toEqual(at({ kind: 'today' }, 4))
    expect(formatRoute(parseRoute('/today?task=abc&signin=failed')!)).toBe('/today')
  })

  it('reads an id of something deleted as that id: what exists is the app’s to check', () => {
    expect(parseRoute('/project/404')).toEqual(at({ kind: 'project', id: 404 }))
  })

  it('names only the kind of place in the title', () => {
    expect(titleOf(at({ kind: 'today' }))).toBe('Today · done')
    expect(titleOf(at({ kind: 'project', id: 7 }, 3))).toBe('Project · done')
    expect(titleOf(at({ kind: 'notes', id: 1 }))).toBe('Note · done')
    expect(titleOf(at({ kind: 'settings', space: 1 }))).toBe('Workspace · done')
  })

  it('knows what is opened over what', () => {
    expect(isOver(at({ kind: 'today' }), at({ kind: 'today' }, 3))).toBe(true)
    expect(isOver(at({ kind: 'today' }), at({ kind: 'inbox' }, 3))).toBe(false)
    expect(isOver(at({ kind: 'notes' }), at({ kind: 'notes', id: 2 }))).toBe(true)
    expect(isOver(at({ kind: 'notes', id: 1 }), at({ kind: 'notes', id: 2 }))).toBe(false)
    expect(isOver(at({ kind: 'settings' }), at({ kind: 'settings', space: 2 }))).toBe(true)
    expect(isOver(at({ kind: 'today' }), at({ kind: 'upcoming' }))).toBe(false)
  })
})

describe('steps through history', () => {
  const entry = (path: string, prev: string | null = null, over = false): Entry => ({ path, prev, over })

  it('does nothing for the place you are on', () => {
    expect(stepTo(entry('/today'), at({ kind: 'today' }))).toEqual({ kind: 'none' })
  })

  it('pushes a view change, remembering where it came from', () => {
    expect(stepTo(entry('/today'), at({ kind: 'upcoming' }))).toEqual({ kind: 'push', entry: entry('/upcoming', '/today') })
  })

  it('pushes a task over its view, and goes back to close it', () => {
    const open = stepTo(entry('/today'), at({ kind: 'today' }, 3))
    expect(open).toEqual({ kind: 'push', entry: entry('/today?task=3', '/today', true) })
    expect(stepTo(entry('/today?task=3', '/today', true), at({ kind: 'today' }))).toEqual({ kind: 'back' })
  })

  it('swaps one open task for another without a step', () => {
    expect(stepTo(entry('/today?task=3', '/today', true), at({ kind: 'today' }, 4))).toEqual({
      kind: 'replace',
      entry: entry('/today?task=4', '/today', true),
    })
  })

  it('lets a view take the entry of a task left open', () => {
    expect(stepTo(entry('/today?task=3', '/today', true), at({ kind: 'focus' }))).toEqual({ kind: 'replace', entry: entry('/focus', '/today') })
  })

  it('closes a task loaded from a link by replacing: there is nothing to go back to', () => {
    expect(stepTo(entry('/today?task=3'), at({ kind: 'today' }))).toEqual({ kind: 'replace', entry: entry('/today', null) })
    expect(stepTo(entry('/notes/4', '/lists'), at({ kind: 'notes' }))).toEqual({ kind: 'replace', entry: entry('/notes', '/lists') })
  })

  it('pushes a note over the notes, and a note beside a note', () => {
    expect(stepTo(entry('/notes', '/lists'), at({ kind: 'notes', id: 1 }))).toEqual({ kind: 'push', entry: entry('/notes/1', '/notes', true) })
    expect(stepTo(entry('/notes/1', '/today'), at({ kind: 'notes', id: 2 }))).toEqual({ kind: 'push', entry: entry('/notes/2', '/notes/1') })
  })

  it('replaces for a move the app made by itself', () => {
    expect(stepTo(entry('/notes', '/today'), at({ kind: 'notes', id: 5 }), true)).toEqual({ kind: 'replace', entry: entry('/notes/5', '/today') })
  })
})
