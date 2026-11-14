import { describe, expect, it } from 'vitest'
import { changeSet, picture } from '@/lib/changes'
import { addTask, markDone, markOpen, patchTask, type Data } from '@/lib/tasks'

const before: Data = {
  rev: 4,
  nextId: 10,
  projects: [{ id: 1, name: 'Home', color: 0 }],
  tasks: [
    { id: 2, title: 'One', notes: '', projectId: null, start: null, due: null, priority: 4 },
    { id: 3, title: 'Two', notes: '', projectId: 1, start: null, due: '2026-11-13', priority: 1 },
  ],
}
const saved = picture(before)
const diff = (after: Data) => changeSet(saved, picture(after), after.rev)

describe('changeSet', () => {
  it('makes no request when nothing differs', () => {
    expect(diff(before)).toBeNull()
    // New objects with the same content are still the same.
    expect(diff(structuredClone(before))).toBeNull()
  })

  it('sends a changed task whole and leaves the unchanged one out', () => {
    const change = diff(patchTask(before, 3, { title: 'Two, edited' }))
    expect(change).toEqual({
      rev: 4,
      projects: [],
      tasks: [{ id: 3, title: 'Two, edited', notes: '', projectId: 1, start: null, due: '2026-11-13', priority: 1 }],
      deleteProjects: [],
      deleteTasks: [],
    })
  })

  it('sends a new task', () => {
    const change = diff(addTask(before, { title: 'Three', due: null, priority: 4, projectId: null }))
    expect(change?.tasks.map((t) => t.id)).toEqual([10])
  })

  it('names what was removed by id, tasks and projects apart', () => {
    const change = diff({ ...before, projects: [], tasks: [before.tasks[0]] })
    expect(change).toMatchObject({ projects: [], tasks: [], deleteProjects: [1], deleteTasks: [3] })
  })

  it('sends nothing for a change that was undone before it was saved', () => {
    const renamed = patchTask(before, 2, { title: 'Changed' })
    expect(diff(patchTask(renamed, 2, { title: 'One' }))).toBeNull()
  })

  it('still counts a change made while an earlier save was in flight', () => {
    // The save in flight took its picture here…
    const first = patchTask(before, 2, { title: 'First' })
    const inFlight = picture(first)
    // …and this happened before it came back. Comparing against the picture
    // that was sent, not a fresh one, keeps the second change unsaved.
    const second = markDone(first, 3, '2026-11-13')
    expect(changeSet(inFlight, picture(second), 5)?.tasks.map((t) => t.id)).toEqual([3])
  })

  it('sends a reopened task without the day it was finished', () => {
    const done = markDone(before, 2, '2026-11-13')
    const change = changeSet(picture(done), picture(markOpen(done, 2)), 5)
    expect(change?.tasks[0]).toEqual({ ...before.tasks[0], done: false })
  })
})
