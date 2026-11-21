// The sounds the interface makes. Each one is described as data (a few
// notes) and synthesized with the Web Audio API: there are no audio files to
// ship or license, and the pitch can follow what the user is doing.
//
// Nobody had listened to these when they were written; the numbers were
// reasoned, and the limits below are what keeps a later change from making
// a sound loud, long or shrill.

export type SoundName = 'complete' | 'completeBig' | 'focusStart' | 'focusDone' | 'open' | 'add' | 'reopen' | 'delete' | 'undo' | 'drop' | 'confirm' | 'error'

export interface Note {
  hz: number
  // Glide to this pitch over the note's length. A slide reads as a gesture
  // (up: something arrives, down: something goes) where two notes would be
  // too much for a small action.
  slideTo?: number
  // Seconds after the sound begins, and how long the note lasts.
  at: number
  length: number
  // Loudest point of the note, before the master gain.
  gain: number
  wave: 'sine' | 'triangle'
}

// ---------- Limits (the tests hold every sound to these) ----------

// Below about 200 Hz a laptop speaker thumps rather than sounds; far above
// 3.5 kHz a pure tone turns piercing.
export const MIN_HZ = 200
export const MAX_HZ = 3600
// Ordinary sounds are over in a quarter of a second. The fuller reward may
// take up to half a second, and nothing may take longer.
export const MAX_LENGTH = 0.25
export const MAX_BIG_LENGTH = 0.5
// One note, and all notes of one sound added up, before the master gain.
export const MAX_NOTE_GAIN = 0.2
export const MAX_SOUND_GAIN = 0.6
// Everything passes through this, so the loudest moment of the loudest sound
// is still under a third of full scale: present at a normal system volume,
// never startling at a high one.
export const MASTER_GAIN = 0.5

// ---------- The key ----------

// Everything is in C major pentatonic (C D E G A). Any two of its notes are
// consonant, so sounds heard one after another belong together, and the
// chime can climb the scale without ever landing on a sour interval.
const PENTATONIC = [0, 2, 4, 7, 9]
const C5 = 523.25
// Step 0 is C5, 1 is D5 … 5 is C6. Negative steps go below C5.
export function pitch(step: number): number {
  const octave = Math.floor(step / 5)
  const semitones = 12 * octave + PENTATONIC[step - 5 * octave]
  return C5 * 2 ** (semitones / 12)
}
const [E4, G4, A4] = [pitch(-3), pitch(-2), pitch(-1)]
const [D5, G5, C6, E6, G6, C7] = [pitch(1), pitch(3), pitch(5), pitch(7), pitch(8), pitch(10)]

// ---------- Momentum ----------

// Finishing tasks one after another moves the chime up the scale, a step per
// task. The window is long enough to read the next task and tick it; the cap
// keeps the top note at A6 so a long run stays pleasant instead of climbing
// out of the range above.
export const STREAK_WINDOW_MS = 4000
export const MAX_STREAK_STEPS = 4

export interface Streak {
  steps: number
  at: number
}
export function nextStreak(last: Streak | null, now: number): Streak {
  const running = last !== null && now - last.at <= STREAK_WINDOW_MS
  return { steps: running ? Math.min(last.steps + 1, MAX_STREAK_STEPS) : 0, at: now }
}

// ---------- The sounds ----------

const sine = (hz: number, at: number, length: number, gain: number): Note => ({ hz, at, length, gain, wave: 'sine' })

// The signature: two rising notes. Unmoved it is G5 to C6, a fourth that
// lands on the key note, which is what makes it sound finished. The second
// note is the louder and longer one and carries a faint octave above it, the
// touch of brightness that makes a sine read as a small bell.
function chime(steps: number): Note[] {
  const low = pitch(3 + steps)
  const high = pitch(5 + steps)
  return [sine(low, 0, 0.11, 0.13), sine(high, 0.065, 0.18, 0.16), sine(high * 2, 0.065, 0.1, 0.025)]
}

// Quieter than the chime on purpose: completing is the reward, these only
// confirm that something happened.
const SOUNDS: Record<Exclude<SoundName, 'complete'>, Note[]> = {
  // The fuller reward: the C major chord from G5 up to G6, each note a little
  // louder than the last so it opens rather than hammers.
  completeBig: [sine(G5, 0, 0.12, 0.11), sine(C6, 0.07, 0.12, 0.12), sine(E6, 0.14, 0.12, 0.13), sine(G6, 0.21, 0.26, 0.15), sine(G6 * 2, 0.21, 0.12, 0.025)],
  // A focus block begins: a soft swell from C5 up an octave, under a held G5.
  // Rising and calm, the sound of settling in rather than of an alarm.
  focusStart: [{ ...sine(C5, 0, 0.22, 0.09), slideTo: C6 }, sine(G5, 0.06, 0.18, 0.06)],
  // A focus block run to its end: the biggest reward there is, the chord
  // climbing a step further than finishing a task does, to C7.
  focusDone: [
    sine(C6, 0, 0.12, 0.1),
    sine(E6, 0.08, 0.12, 0.11),
    sine(G6, 0.16, 0.12, 0.12),
    sine(C7, 0.24, 0.26, 0.15),
    sine(D5, 0.24, 0.24, 0.05),
  ],
  // Something opens (search, find): the faintest tick, so a keypress is felt.
  open: [sine(E6, 0, 0.04, 0.045)],
  // A pop: a very short slide up a fifth.
  add: [{ ...sine(C5, 0, 0.07, 0.12), slideTo: G5 }],
  // The chime backwards and softer: C6 down to G5.
  reopen: [sine(C6, 0, 0.1, 0.09), sine(G5, 0.065, 0.16, 0.1)],
  // Low and falling, so it does not sound like a reward or an alarm.
  delete: [{ ...sine(A4, 0, 0.09, 0.1), slideTo: E4 }],
  // Delete, backwards: the thing comes back.
  undo: [{ ...sine(E4, 0, 0.09, 0.1), slideTo: A4 }],
  // Something set down. A triangle wave has a few soft overtones, which
  // makes so short a note read as a tap rather than a beep.
  drop: [{ hz: G4, slideTo: E4, at: 0, length: 0.05, gain: 0.11, wave: 'triangle' }],
  // The smallest sound here: heard often, so it is the shortest and quietest.
  confirm: [sine(C6, 0, 0.045, 0.07)],
  // One low note, no interval and no repeat: it says "no" without alarm. A
  // triangle, because a sine this low is nearly lost on a laptop speaker.
  error: [{ hz: E4, at: 0, length: 0.22, gain: 0.12, wave: 'triangle' }],
}

// What to play for an action at time `now`, and what the momentum is
// afterwards. Pure: the player below is the only part that touches audio.
export function plan(name: SoundName, on: boolean, streak: Streak | null, now: number): { notes: Note[]; streak: Streak | null } {
  if (!on) return { notes: [], streak }
  if (name === 'complete') {
    const next = nextStreak(streak, now)
    return { notes: chime(next.steps), streak: next }
  }
  // The fuller reward is always the same chord, but it is still a completion
  // and keeps a run going.
  if (name === 'completeBig' || name === 'focusDone') return { notes: SOUNDS[name], streak: nextStreak(streak, now) }
  return { notes: SOUNDS[name], streak }
}

// ---------- The setting ----------

const KEY = 'done-sounds'
function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
let on = stored()
export const soundsOn = (): boolean => on
export function setSoundsOn(next: boolean) {
  on = next
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // Private windows may refuse storage; the choice still holds for now.
  }
}

// ---------- The player ----------

// A note fades in over this long. Starting at full level would click.
const ATTACK = 0.008

let context: AudioContext | null = null
let master: GainNode | null = null
let streak: Streak | null = null

function schedule(notes: Note[]) {
  // One context for the whole app, made on first use. Every `play` comes
  // from something the user did, which is when WebKit allows audio to start.
  if (!context) {
    context = new AudioContext()
    master = context.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(context.destination)
  }
  // WebKit starts a context suspended and suspends it again when the app has
  // been in the background. Notes scheduled now play once it is running.
  if (context.state !== 'running') void context.resume()
  if (!master) return
  // A moment ahead, so the first fade-in is never cut off.
  const begin = context.currentTime + 0.01
  for (const note of notes) {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const start = begin + note.at
    const end = start + note.length
    oscillator.type = note.wave
    oscillator.frequency.setValueAtTime(note.hz, start)
    if (note.slideTo) oscillator.frequency.exponentialRampToValueAtTime(note.slideTo, end)
    // A quick linear rise, then an exponential fall: the shape of something
    // struck, which is why it sounds natural and never cuts off.
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(note.gain, start + ATTACK)
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(envelope)
    envelope.connect(master)
    oscillator.onended = () => {
      oscillator.disconnect()
      envelope.disconnect()
    }
    oscillator.start(start)
    oscillator.stop(end)
  }
}

export function play(name: SoundName) {
  const planned = plan(name, on, streak, Date.now())
  streak = planned.streak
  if (planned.notes.length === 0) return
  try {
    schedule(planned.notes)
  } catch {
    // No AudioContext, or the system refused it. A sound is never worth
    // breaking the action that asked for it.
  }
}
