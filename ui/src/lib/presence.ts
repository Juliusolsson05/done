// Who is in a note, and whether they are there or have stepped away, as in
// Google Docs. Each window says this about itself in the note's awareness
// (lib/collab.ts): its person, and whether it is idle and since when.
//
// Whether a window is idle is decided by that window, by its own clock, and
// sent as a flag: two machines' clocks are never quite the same, so a
// moment's difference must not make someone look away. The time it went idle
// is only used to say for how long.

// No typing, moving the cursor or the pointer in the note for this long, or
// the note's window not in view: idle.
export const IDLE_AFTER = 60_000
// While active, the time of the last activity is sent at most this often.
export const BEAT_EVERY = 10_000

export interface Activity {
  idle: boolean
  // When the person last did something in the note, by their clock.
  since: number
}

// A window's own activity: idle once it has been still for a minute, or the
// moment its window is hidden.
export const activityNow = (lastActive: number, hidden: boolean, now: number): Activity => ({
  idle: hidden || now - lastActive >= IDLE_AFTER,
  since: lastActive,
})

// Whether to tell the others now: at once when idle and active swap, and
// while active, at most every BEAT_EVERY.
export function shouldTell(sent: Activity | null, next: Activity, sentAt: number, now: number): boolean {
  if (!sent || sent.idle !== next.idle) return true
  return !next.idle && now - sentAt >= BEAT_EVERY
}

// "Geart, idle for 5 minutes", for the face's tooltip.
export function idleText(name: string, activity: Activity, now: number): string {
  if (!activity.idle) return `${name}, active now`
  const minutes = Math.max(0, Math.floor((now - activity.since) / 60_000))
  if (minutes < 1) return `${name}, idle`
  if (minutes < 60) return `${name}, idle for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  return `${name}, idle for ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export interface User {
  account: string
  name: string
  picture: string
  color: string
}

export interface Here extends User {
  activity: Activity
}

interface State {
  user?: Partial<User>
  activity?: Partial<Activity>
}

// The people in the note other than you, from the awareness states: one face
// per person however many windows they have it open in (active if any of them
// is), the active first, then by name.
export function peopleHere(states: Map<number, unknown>, me: string | null): Here[] {
  const people = new Map<string, Here>()
  for (const raw of states.values()) {
    const state = raw as State | null
    const user = state?.user
    if (!user?.account || user.account === me) continue
    const activity: Activity = { idle: state?.activity?.idle === true, since: Number(state?.activity?.since) || 0 }
    const was = people.get(user.account)
    const here: Here = { account: user.account, name: user.name ?? '', picture: user.picture ?? '', color: user.color ?? '', activity }
    if (!was) people.set(user.account, here)
    else if (was.activity.idle && (!activity.idle || activity.since > was.activity.since)) people.set(user.account, { ...was, activity })
  }
  return [...people.values()].sort((a, b) => Number(a.activity.idle) - Number(b.activity.idle) || a.name.localeCompare(b.name))
}

// What the note's header says beside the faces: "Geart is here",
// "Geart and Ana are here", or "Geart is idle".
export function hereText(people: Here[]): string {
  if (!people.length) return ''
  const first = (p: Here) => p.name.split(/\s+/)[0] || 'Someone'
  if (people.length === 1) return `${first(people[0])} is ${people[0].activity.idle ? 'idle' : 'here'}`
  if (people.length === 2) return `${first(people[0])} and ${first(people[1])} are here`
  return `${first(people[0])} and ${people.length - 1} others are here`
}

// A colour made fainter, for an idle person's cursor: the same hue at 40%.
export const faded = (color: string): string => (/^#[0-9a-f]{6}$/i.test(color) ? color + '66' : color)
