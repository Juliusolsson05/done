import { describe, expect, it } from 'vitest'
import { onlyOnDevice, ONLY_HERE } from '@/lib/on-device'
import type { Data, Task } from '@/lib/tasks'

const task = (id: number) => ({ id, title: 'Inbox thing EDITED' }) as Task
const data = (localOnly?: number[]): Data => ({ rev: 1, nextId: 1, projects: [], tasks: [task(1), task(2)], localOnly })

// Issue #120, A: the person is told when a task is only on this device.
describe('onlyOnDevice', () => {
  it('marks the tasks the account would not take, and only those', () => {
    expect(onlyOnDevice(task(1), data([1]))).toBe(true)
    expect(onlyOnDevice(task(2), data([1]))).toBe(false)
    expect(onlyOnDevice(task(1), data())).toBe(false)
  })

  it('says it plainly', () => {
    expect(ONLY_HERE).toMatch(/^Only on this device\./)
  })
})
