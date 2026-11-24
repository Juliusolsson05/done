// What a workspace note shows about the others writing it: their faces, who
// is active and who has stepped away, and a quiet line when the connection
// is gone. The document itself is lib/collab.ts.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { WifiOffIcon } from 'lucide-react'
import { Avatar } from '@/components/avatars'
import { liveTicket } from '@/lib/backend'
import { LiveNote, NotLive, type Opening } from '@/lib/collab'
import { useApp } from '@/lib/app-context'
import { hereText, idleText, peopleHere, type Here } from '@/lib/presence'
import { tintOf, type Team } from '@/lib/team'
import { cn } from '@/lib/utils'

// A ticket from the main server; "not found" means this note is not written live.
async function open(ask: { note?: number; space?: number }): Promise<Opening> {
  try {
    return await liveTicket(ask)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) throw new NotLive()
    throw error
  }
}

// The live copy of a note while it is open; null for a note that is not in a workspace.
export function useLiveNote(note: number | null, team: Team | null): LiveNote | null {
  const [live, setLive] = useState<LiveNote | null>(null)
  const me = team?.me ?? null
  const you = team?.spaces.flatMap((s) => s.members).find((m) => m.id === me)
  useEffect(() => {
    if (note === null) return setLive(null)
    const made = new LiveNote(note, () => open({ note }))
    setLive(made)
    return () => made.destroy()
  }, [note])
  useEffect(() => {
    if (live && me) live.setUser({ account: me, name: you?.name || you?.email || 'Someone', picture: you?.picture ?? '', color: tintOf(me) })
  }, [live, me, you?.name, you?.email, you?.picture])
  return live
}

// Redrawn when the live copy says something changed: opened, live, offline.
export function useLiveStatus(live: LiveNote | null) {
  return useSyncExternalStore(
    (listener) => live?.subscribe(listener) ?? (() => {}),
    () => (live ? `${live.status}:${live.synced}` : 'none'),
  )
}

// A minute is enough to keep "idle for 5 minutes" true.
function useMinute() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// One face: drawn plainly when active, faint and grey when idle, saying which.
export function Face({ who, now, size = 'sm' }: { who: Here; now: number; size?: 'xs' | 'sm' }) {
  return (
    <span
      title={idleText(who.name || 'Someone', who.activity, now)}
      className={cn('inline-flex rounded-full', who.activity.idle && 'opacity-40 grayscale')}
    >
      <Avatar
        who={{ id: who.account, name: who.name, email: '', picture: who.picture }}
        size={size}
        className="pointer-events-none ring-2 ring-background"
      />
    </span>
  )
}

export function Faces({ people, size = 'sm', className }: { people: Here[]; size?: 'xs' | 'sm'; className?: string }) {
  const now = useMinute()
  if (!people.length) return null
  return (
    <span className={cn('inline-flex items-center [&>*+*]:-ml-1.5', className)}>
      {people.slice(0, 4).map((p) => (
        <Face key={p.account} who={p} now={now} size={size} />
      ))}
      {people.length > 4 && <span className="ml-1 text-xs text-muted-foreground">+{people.length - 4}</span>}
    </span>
  )
}

// Who else has the note open, from its awareness.
function useHere(live: LiveNote | null, me: string | null): Here[] {
  const [states, setStates] = useState(0)
  useEffect(() => {
    if (!live) return
    const changed = () => setStates((n) => n + 1)
    live.awareness.on('change', changed)
    return () => live.awareness.off('change', changed)
  }, [live])
  // `states` is what makes this read again when someone comes, goes or idles.
  return useMemo(() => (live ? peopleHere(live.awareness.getStates(), me) : []), [live, me, states])
}

// Who else has the open note, for the page header next to its actions.
// Julius, 23 Nov: the faces belong in the header, where they are seen.
export function LiveFaces({ live }: { live: LiveNote | null }) {
  const { me } = useApp()
  const here = useHere(live, me)
  if (!here.length) return null
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <Faces people={here} />
      <span className="max-md:hidden">{hereText(here)}</span>
    </span>
  )
}

// Above a live note: whether the connection is there. Who is here is in the
// header (LiveFaces).
export function LiveBar({ live }: { live: LiveNote }) {
  const { me } = useApp()
  useLiveStatus(live)
  const here = useHere(live, me)
  // Who was here before the connection went: their faces go with it, but
  // the line still says whose writing yours joins.
  const lastSeen = useRef('')
  if (here.length) lastSeen.current = here[0].name.split(/\s+/)[0]
  const others = lastSeen.current
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground empty:hidden">
      {live.status === 'offline' && (
        <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <WifiOffIcon className="size-3.5" />
          Offline. Your writing is kept and joins {others ? `${others}’s` : 'the others’'} when you are back.
        </span>
      )}
      {live.status === 'opening' && !live.synced && <span>Opening…</span>}
    </div>
  )
}
