import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BIG_LENGTH,
  MAX_HZ,
  MAX_LENGTH,
  MAX_NOTE_GAIN,
  MAX_SOUND_GAIN,
  MAX_STREAK_STEPS,
  MIN_HZ,
  nextStreak,
  pitch,
  plan,
  play,
  setSoundsOn,
  STREAK_WINDOW_MS,
  type Note,
  type SoundName,
  type Streak,
} from '@/lib/sounds'

// A Record so that adding a sound without listing it here fails to compile.
const NAMES = Object.keys({
  complete: 1,
  completeBig: 1,
  focusStart: 1,
  focusDone: 1,
  open: 1,
  add: 1,
  reopen: 1,
  delete: 1,
  undo: 1,
  drop: 1,
  confirm: 1,
  error: 1,
} satisfies Record<SoundName, 1>) as SoundName[]

// Completions `gap` milliseconds apart, and the chime each one gets.
function run(count: number, gap: number): Note[][] {
  let streak: Streak | null = null
  return Array.from({ length: count }, (_, i) => {
    const planned = plan('complete', true, streak, 1000 + i * gap)
    streak = planned.streak
    return planned.notes
  })
}

// Every sound there is, with the chime at each height it can reach.
const everySound: [string, Note[]][] = [
  ...run(MAX_STREAK_STEPS + 3, 500).map((notes, i): [string, Note[]] => [`complete, ${i} in a row`, notes]),
  ...NAMES.filter((name) => name !== 'complete').map((name): [string, Note[]] => [name, plan(name, true, null, 0).notes]),
]
const lengthOf = (notes: Note[]) => Math.max(...notes.map((n) => n.at + n.length))

describe('pitch', () => {
  it('walks the C major pentatonic scale across octaves', () => {
    expect(pitch(0)).toBeCloseTo(523.25, 2)
    expect(pitch(4)).toBeCloseTo(880, 1) // A5
    expect(pitch(5)).toBeCloseTo(1046.5, 1) // C6
    expect(pitch(-1)).toBeCloseTo(440, 1) // A4
  })
})

describe('momentum', () => {
  it('moves the chime one scale step up for each quick completion', () => {
    const [first, second, third] = run(3, 1500)
    expect(first[0].hz).toBeCloseTo(pitch(3), 3)
    expect(second[0].hz).toBeCloseTo(pitch(4), 3)
    expect(third[0].hz).toBeCloseTo(pitch(5), 3)
    // The whole chime moves, not only its first note.
    expect(second[1].hz).toBeGreaterThan(first[1].hz)
  })

  it('stops climbing after the cap', () => {
    const chimes = run(MAX_STREAK_STEPS + 4, 500)
    const top = chimes[MAX_STREAK_STEPS]
    expect(top[0].hz).toBeGreaterThan(chimes[MAX_STREAK_STEPS - 1][0].hz)
    for (const later of chimes.slice(MAX_STREAK_STEPS)) expect(later).toEqual(top)
  })

  it('starts from the bottom again after a pause', () => {
    const quick = run(3, 500)
    const slow = run(3, STREAK_WINDOW_MS + 1)
    expect(slow[2]).toEqual(quick[0])
    // Right at the edge of the window still counts as quick.
    expect(nextStreak({ steps: 1, at: 0 }, STREAK_WINDOW_MS).steps).toBe(2)
    expect(nextStreak({ steps: 1, at: 0 }, STREAK_WINDOW_MS + 1).steps).toBe(0)
  })

  it('is kept going by a goal completion and left alone by other sounds', () => {
    const before: Streak = { steps: 1, at: 1000 }
    expect(plan('completeBig', true, before, 2000).streak).toEqual({ steps: 2, at: 2000 })
    expect(plan('add', true, before, 2000).streak).toBe(before)
  })
})

describe('the fuller reward', () => {
  const big = plan('completeBig', true, null, 0).notes
  const small = plan('complete', true, null, 0).notes
  const starts = (notes: Note[]) => new Set(notes.map((n) => n.at)).size

  it('has more notes in a row than the chime, each higher than the last', () => {
    expect(starts(small)).toBe(2)
    expect(starts(big)).toBeGreaterThan(starts(small))
    const melody = big.filter((n) => n.gain > 0.05).map((n) => n.hz)
    expect(melody).toEqual([...melody].sort((a, b) => a - b))
  })

  it('is longer than the chime but under half a second', () => {
    expect(lengthOf(big)).toBeGreaterThan(lengthOf(small))
    expect(lengthOf(big)).toBeLessThanOrEqual(MAX_BIG_LENGTH)
  })
})

describe('reopening mirrors completing', () => {
  it('falls where the chime rises', () => {
    const up = plan('complete', true, null, 0).notes
    const down = plan('reopen', true, null, 0).notes
    expect(up[1].hz).toBeGreaterThan(up[0].hz)
    expect(down[1].hz).toBeLessThan(down[0].hz)
  })
})

describe.each(everySound)('limits: %s', (name, notes) => {
  it('makes a sound', () => expect(notes.length).toBeGreaterThan(0))

  it('is short', () => {
    expect(lengthOf(notes)).toBeLessThanOrEqual(name === 'completeBig' || name === 'focusDone' ? MAX_BIG_LENGTH : MAX_LENGTH)
  })

  it('is quiet', () => {
    for (const note of notes) {
      expect(note.gain).toBeGreaterThan(0)
      expect(note.gain).toBeLessThanOrEqual(MAX_NOTE_GAIN)
    }
    expect(notes.reduce((sum, n) => sum + n.gain, 0)).toBeLessThanOrEqual(MAX_SOUND_GAIN)
  })

  it('stays in the range a laptop speaker plays well', () => {
    for (const hz of notes.flatMap((n) => [n.hz, n.slideTo ?? n.hz])) {
      expect(hz).toBeGreaterThanOrEqual(MIN_HZ)
      expect(hz).toBeLessThanOrEqual(MAX_HZ)
    }
  })

  it('has no note too short to fade in', () => {
    for (const note of notes) expect(note.length).toBeGreaterThanOrEqual(0.04)
  })
})

describe('nothing is louder than completing', () => {
  it.each(NAMES.filter((n) => n !== 'complete' && n !== 'completeBig' && n !== 'focusDone'))('%s', (name) => {
    const loudest = (notes: Note[]) => Math.max(...notes.map((n) => n.gain))
    expect(loudest(plan(name, true, null, 0).notes)).toBeLessThan(loudest(plan('complete', true, null, 0).notes))
  })
})

describe('turned off', () => {
  it.each(NAMES)('plans no notes for %s and leaves the momentum alone', (name) => {
    const before: Streak = { steps: 2, at: 1000 }
    expect(plan(name, false, before, 1500)).toEqual({ notes: [], streak: before })
  })
})

// The player, against a stand-in for the Web Audio API that counts what is
// started. Tests run in order: the first needs there to be no AudioContext.
describe('play', () => {
  it('does nothing, quietly, where there is no AudioContext', () => {
    setSoundsOn(true)
    expect(() => play('complete')).not.toThrow()
  })

  it('starts one oscillator per note, resumes a suspended context, and schedules nothing when off', () => {
    const started: number[] = []
    let resumed = 0
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} })
    const node = () => ({ connect() {}, disconnect() {} })
    class FakeContext {
      state = 'suspended'
      currentTime = 0
      destination = node()
      resume() {
        resumed++
        return Promise.resolve()
      }
      createGain() {
        return { ...node(), gain: param() }
      }
      createOscillator() {
        return { ...node(), type: 'sine', frequency: param(), onended: null, start: (at: number) => started.push(at), stop() {} }
      }
    }
    vi.stubGlobal('AudioContext', FakeContext)

    play('completeBig')
    expect(started).toHaveLength(plan('completeBig', true, null, 0).notes.length)
    expect(resumed).toBe(1)

    started.length = 0
    setSoundsOn(false)
    for (const name of NAMES) play(name)
    expect(started).toEqual([])

    setSoundsOn(true)
    play('confirm')
    expect(started).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})
