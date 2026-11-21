import { describe, expect, it } from 'vitest'
import { byFinishedDay } from '@/lib/completed'
import type { Task } from '@/lib/tasks'

const done = (id: number, day: string): Task => ({
  id,
  title: 'T' + id,
  notes: '',
  projectId: null,
  start: null,
  due: null,
  priority: 4,
  done: true,
  doneDay: day,
})

describe('byFinishedDay', () => {
  it('groups by the day finished, newest day first, with plain labels', () => {
    const groups = byFinishedDay([done(3, '2026-11-21'), done(2, '2026-11-20'), done(1, '2026-11-21'), done(4, '2026-11-02')], '2026-11-21')
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['Today', [3, 1]],
      ['Yesterday', [2]],
      ['2 Nov', [4]],
    ])
  })
})
