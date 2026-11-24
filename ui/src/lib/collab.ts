// A workspace note written live: this window's copy of the note's Yjs
// document, kept in step with the room for the note on the live notes
// service (crates/server/src/collab.rs) over the y-websocket protocol.
//
// A small provider of its own rather than y-websocket's: every connection
// needs a fresh ticket from the main server (they last two minutes, and
// Cloud Run ends every connection within the hour), and the window needs to
// know plainly whether it is live, still opening, or offline.
//
// Offline, the copy keeps what is typed; when the connection is back the two
// sides swap what the other lacks, and the room merges it with everyone
// else's. Nothing typed is sent any other way: the room is the one writer of
// a live note's text.
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { activityNow, faded, shouldTell, type Activity, type User } from '@/lib/presence'

// The name of the note's one text; the room uses the same.
export const TEXT = 'text'

const SYNC = 0
const AWARENESS = 1
const QUERY_AWARENESS = 3

export type Status = 'opening' | 'live' | 'offline' | 'off'

export interface Opening {
  ticket: string
  // The live notes service's address, as the main server gives it.
  url: string
}

// The address to open a note at: the service's address made a WebSocket one.
export function socketUrl(base: string, note: number, ticket: string): string {
  const root = base.replace(/\/+$/, '').replace(/^http(s?):\/\//, 'ws$1://')
  return `${root}/notes/${note}?ticket=${encodeURIComponent(ticket)}`
}

// The same service, for plain requests (who is in which note).
export const httpUrl = (base: string): string => base.replace(/\/+$/, '').replace(/^ws(s?):\/\//, 'http$1://')

// How long to wait before trying again: soon at first, then less often, at most 10 s.
export const backoff = (attempt: number): number => Math.min(10_000, 500 * 2 ** Math.max(0, attempt))

// Asking for a ticket was answered "not found": live notes are off on this
// server, or the note is no longer in a workspace. The note is then written
// the ordinary way.
export class NotLive extends Error {}

// How many "not found" answers a note gets before it is written the ordinary
// way for good: with the backoff, about a minute.
export const NOT_FOUND_TRIES = 6

export class LiveNote {
  readonly doc = new Y.Doc()
  readonly text = this.doc.getText(TEXT)
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  // Undo takes back only what you typed, never what the others did.
  readonly undo = new Y.UndoManager(this.text)
  status: Status = 'opening'
  // Whether the room's copy has arrived at least once. Until it has, there is
  // nothing to type into: the note is shown as stored.
  synced = false

  private ws: WebSocket | null = null
  private attempts = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private watch: ReturnType<typeof setInterval> | undefined
  private stopped = false
  // How many times asking for a ticket was answered "not found".
  private notFound = 0
  private listeners = new Set<() => void>()
  private user: User | null = null
  private lastActive = Date.now()
  private told: Activity | null = null
  private toldAt = 0

  constructor(
    readonly note: number,
    private readonly open: () => Promise<Opening>,
  ) {
    this.doc.on('update', this.onUpdate)
    this.awareness.on('update', this.onAwareness)
    window.addEventListener('online', this.tryNow)
    document.addEventListener('visibilitychange', this.onVisibility)
    // Idle is noticed by the window itself, so it is looked at now and then.
    this.watch = setInterval(() => this.tell(), 5_000)
    void this.connect()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }

  private setStatus(status: Status) {
    if (this.status === status) return
    this.status = status
    this.changed()
  }

  // Who this window is, for the others' cursors and faces.
  setUser(user: User) {
    this.user = user
    this.told = null
    this.tell()
  }

  // Something was done in the note: typing, moving the cursor, the pointer.
  active() {
    this.lastActive = Date.now()
    this.tell()
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.lastActive = Date.now()
    this.tell()
  }

  private tell() {
    if (!this.user) return
    const now = Date.now()
    const activity = activityNow(this.lastActive, document.visibilityState === 'hidden', now)
    if (!shouldTell(this.told, activity, this.toldAt, now)) return
    this.told = activity
    this.toldAt = now
    // An idle person's cursor stays, fainter.
    const color = activity.idle ? faded(this.user.color) : this.user.color
    // Added to what is there, not in its place: the editor keeps the cursor
    // and the selection in the same state (y-codemirror.next's `cursor`), and
    // replacing the whole state took them from the others' view at every
    // heartbeat and every change between active and idle (23 Nov 2026).
    this.awareness.setLocalState({
      ...this.awareness.getLocalState(),
      user: { ...this.user, color, colorLight: faded(this.user.color) },
      activity,
    })
  }

  private send(data: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data as Uint8Array<ArrayBuffer>)
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, SYNC)
    syncProtocol.writeUpdate(encoder, update)
    this.send(encoding.toUint8Array(encoder))
  }

  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]))
    this.send(encoding.toUint8Array(encoder))
  }

  private tryNow = () => {
    if (this.ws || this.stopped) return
    clearTimeout(this.retry)
    this.attempts = 0
    void this.connect()
  }

  private later() {
    if (this.stopped) return
    clearTimeout(this.retry)
    this.retry = setTimeout(() => void this.connect(), backoff(this.attempts++))
  }

  private async connect() {
    if (this.stopped || this.ws) return
    let opening: Opening
    try {
      opening = await this.open()
    } catch (error) {
      if (error instanceof NotLive) {
        // Written the ordinary way meanwhile. Asked again a few times: a note
        // made on this device reaches the server a moment after it is opened,
        // and the first ask can come before it (23 Nov: one such answer left
        // a new note off for good, so nobody saw who else was in it).
        this.setStatus('off')
        if (this.notFound++ < NOT_FOUND_TRIES) this.later()
        return
      }
      this.setStatus(this.synced ? 'offline' : 'opening')
      return this.later()
    }
    if (this.stopped) return
    const ws = new WebSocket(socketUrl(opening.url, this.note, opening.ticket))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.attempts = 0
      // What this copy has, so the room sends what it lacks; and who is here.
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, SYNC)
      syncProtocol.writeSyncStep1(encoder, this.doc)
      this.send(encoding.toUint8Array(encoder))
      if (this.awareness.getLocalState() !== null) {
        const said = encoding.createEncoder()
        encoding.writeVarUint(said, AWARENESS)
        encoding.writeVarUint8Array(said, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
        this.send(encoding.toUint8Array(said))
      }
    }
    ws.onmessage = (event: MessageEvent<ArrayBuffer>) => this.receive(new Uint8Array(event.data))
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      // The others' faces go while this window cannot see them.
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this)
      if (this.stopped) return
      this.setStatus(this.synced ? 'offline' : 'opening')
      this.later()
    }
  }

  private receive(data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    // One frame may hold several messages, one after another.
    while (decoding.hasContent(decoder)) {
      const kind = decoding.readVarUint(decoder)
      if (kind === SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, SYNC)
        const step = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
        if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder))
        if (step === syncProtocol.messageYjsSyncStep2 && !this.synced) {
          this.synced = true
          this.changed()
        }
        if (this.synced) this.setStatus('live')
      } else if (kind === AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this)
      } else if (kind === QUERY_AWARENESS) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, AWARENESS)
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]))
        this.send(encoding.toUint8Array(encoder))
      } else {
        return
      }
    }
  }

  destroy() {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.watch)
    window.removeEventListener('online', this.tryNow)
    document.removeEventListener('visibilitychange', this.onVisibility)
    // Gone from the others' view at once, rather than when the room notices.
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.ws?.close()
    this.ws = null
    this.undo.destroy()
    this.awareness.destroy()
    this.doc.destroy()
    this.listeners.clear()
  }
}
