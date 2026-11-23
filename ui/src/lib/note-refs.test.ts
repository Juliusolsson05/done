import { describe, expect, it } from 'vitest'
import { folds, isOpened, setOpened, summary } from '@/lib/note-refs'

describe('note references', () => {
  it('folds only when there are more than a few', () => {
    expect(folds(3, 1)).toBe(false)
    expect(folds(4, 1)).toBe(true)
    expect(folds(0, 5)).toBe(true)
  })

  it('says what is folded in plain words', () => {
    expect(summary(12, 3)).toBe('12 tasks and 3 links')
    expect(summary(1, 0)).toBe('1 task')
    expect(summary(0, 2)).toBe('2 links')
  })

  it('remembers a note opened up, for this session', () => {
    expect(isOpened(7)).toBe(false)
    setOpened(7, true)
    expect(isOpened(7)).toBe(true)
    setOpened(7, false)
    expect(isOpened(7)).toBe(false)
  })
})
