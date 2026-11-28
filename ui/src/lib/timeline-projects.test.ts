import { describe, expect, it } from 'vitest'
import { projectTimelines } from '@/lib/timeline-projects'
import type { Project, Task } from '@/lib/tasks'
import { NO_FILTER } from '@/lib/view-filter'

const projects: Project[] = [
  { id: 1, name: 'Open house', sprint: { enabled: true, deadline: '2026-12-04', completed: false } },
  { id: 2, name: 'Print run', sprint: { enabled: true, deadline: '2026-11-20', completed: true } },
  { id: 3, name: 'Operations' },
  { id: 4, name: 'Unscheduled' },
]
const task = (id: number, projectId: number, due: string | null, extra: Partial<Task> = {}): Task => ({
  id, title: String(id), notes: '', projectId, start: null, due, priority: 4, ...extra,
})

describe('project ranges on Timeline', () => {
  it('covers scheduled dates and keeps deadline-only sprints', () => {
    const rows = projectTimelines(projects, [
      task(10, 1, '2026-12-01', { start: '2026-11-25' }),
      task(11, 3, '2026-11-27'),
      task(12, 3, '2026-11-29', { done: true }),
      task(13, 4, null),
      task(14, 99, '2026-11-27'),
    ], NO_FILTER)

    expect(rows.map(({ project, from, to, deadline }) => [project.id, from, to, deadline])).toEqual([
      [1, '2026-11-25', '2026-12-04', '2026-12-04'],
      [2, '2026-11-20', '2026-11-20', '2026-11-20'],
      [3, '2026-11-27', '2026-11-27', null],
    ])
  })

  it('covers exactly the open tasks of a project, and nothing else stretches it', () => {
    const rows = projectTimelines(projects, [
      task(10, 3, '2026-12-03', { start: '2026-12-01' }),
      task(11, 3, '2026-12-05', { start: '2026-12-04' }),
      task(12, 3, null, { start: '2026-12-02' }),
      task(13, 3, '2026-12-15', { parentId: 10 }),
      task(14, 3, '2026-12-16', { done: true, doneDay: '2026-12-16' }),
      task(15, 3, null),
    ], { ...NO_FILTER, projects: [3] })
    expect(rows).toMatchObject([{ from: '2026-12-01', to: '2026-12-05', deadline: null }])
  })

  it('keeps later tasks in the range when the sprint deadline comes first', () => {
    expect(projectTimelines(projects, [task(10, 1, '2026-12-09')], { ...NO_FILTER, projects: [1] })).toMatchObject([
      { from: '2026-12-04', to: '2026-12-09', deadline: '2026-12-04' },
    ])
  })

  it('honors project and task filters without hiding an explicitly selected empty sprint', () => {
    expect(projectTimelines(projects, [], { ...NO_FILTER, projects: [null] })).toEqual([])
    expect(projectTimelines(projects, [], { ...NO_FILTER, projects: [2] })).toMatchObject([{ project: { id: 2 } }])
    expect(projectTimelines(projects, [task(10, 1, null)], { ...NO_FILTER, words: 'flyers' })).toMatchObject([{ project: { id: 1 } }])
    expect(projectTimelines(projects, [], { ...NO_FILTER, words: 'flyers' })).toEqual([])
  })
})
