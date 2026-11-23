// Two windows writing one note through a room that behaves as the live notes
// service does (crates/server/src/collab.rs is tested on its own against
// real sockets): this is the window's half of the protocol.
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

// The provider listens to the window and the document; a stand-in for each.
vi.hoisted(() => {
  const target = new EventTarget()
  Object.assign(globalThis, {
    window: target,
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  })
})
import { backoff, httpUrl, LiveNote, NotLive, socketUrl, TEXT } from '@/lib/collab'

// A room: answers a window's state with what it lacks, and passes every
// change and every awareness message on to the others.
class Room {
  doc = new Y.Doc()
  sockets = new Set<FakeSocket>()
  receive(from: FakeSocket, data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    while (decoding.hasContent(decoder)) {
      const kind = decoding.readVarUint(decoder)
      if (kind === 0) {
        const reply = encoding.createEncoder()
        encoding.writeVarUint(reply, 0)
        const before = Y.encodeStateVector(this.doc)
        syncProtocol.readSyncMessage(decoder, reply, this.doc, from)
        if (encoding.length(reply) > 1) from.deliver(encoding.toUint8Array(reply))
        const update = Y.encodeStateAsUpdate(this.doc, before)
        if (update.length > 2) {
          const out = encoding.createEncoder()
          encoding.writeVarUint(out, 0)
          syncProtocol.writeUpdate(out, update)
          for (const s of this.sockets) if (s !== from) s.deliver(encoding.toUint8Array(out))
        }
      } else if (kind === 1) {
        const update = decoding.readVarUint8Array(decoder)
        const out = encoding.createEncoder()
        encoding.writeVarUint(out, 1)
        encoding.writeVarUint8Array(out, update)
        for (const s of this.sockets) if (s !== from) s.deliver(encoding.toUint8Array(out))
      }
    }
  }
  join(socket: FakeSocket) {
    this.sockets.add(socket)
    const hello = encoding.createEncoder()
    encoding.writeVarUint(hello, 0)
    syncProtocol.writeSyncStep1(hello, this.doc)
    socket.deliver(encoding.toUint8Array(hello))
  }
}

let room = new Room()
let down = false
const opened: string[] = []

class FakeSocket {
  static OPEN = 1
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {
    opened.push(url)
    queueMicrotask(() => {
      if (down) return this.close()
      this.readyState = 1
      this.onopen?.()
      room.join(this)
    })
  }
  send(data: Uint8Array) {
    if (this.readyState === 1) room.receive(this, data)
  }
  deliver(data: Uint8Array) {
    if (this.readyState === 1) queueMicrotask(() => this.onmessage?.({ data: data.slice().buffer }))
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    room.sockets.delete(this)
    queueMicrotask(() => this.onclose?.())
  }
}
Object.assign(globalThis, { WebSocket: FakeSocket })

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const window_ = (tickets = { n: 0 }) =>
  new LiveNote(7, async () => {
    tickets.n++
    return { ticket: `t${tickets.n} &=`, url: 'https://collab.example' }
  })

describe('addresses', () => {
  it('turns the service address into a socket one, with the ticket written safely', () => {
    expect(socketUrl('https://collab.example/', 7, 'a b&c')).toBe('wss://collab.example/notes/7?ticket=a%20b%26c')
    expect(socketUrl('http://127.0.0.1:4484', 7, 't')).toBe('ws://127.0.0.1:4484/notes/7?ticket=t')
    expect(socketUrl('wss://collab.example', 7, 't')).toBe('wss://collab.example/notes/7?ticket=t')
    expect(httpUrl('wss://collab.example/')).toBe('https://collab.example')
    expect([0, 1, 2, 5, 9].map(backoff)).toEqual([500, 1000, 2000, 10_000, 10_000])
  })
})

describe('a live note', () => {
  it('gets the room’s text, and two windows typing at once both keep their words', async () => {
    room = new Room()
    room.doc.getText(TEXT).insert(0, 'Week plan\n')
    const a = window_()
    const b = window_()
    await settle()
    expect([a.synced, b.synced, a.status]).toEqual([true, true, 'live'])
    expect(a.text.toString()).toBe('Week plan\n')
    a.text.insert(a.text.length, 'Julius: filter\n')
    b.text.insert(b.text.length, 'Geart: circles\n')
    await settle()
    expect(a.text.toString()).toBe(b.text.toString())
    expect(a.text.toString()).toContain('Julius: filter')
    expect(a.text.toString()).toContain('Geart: circles')
    // Undo takes back your own typing only.
    a.undo.undo()
    await settle()
    expect(b.text.toString()).not.toContain('Julius: filter')
    expect(b.text.toString()).toContain('Geart: circles')
    a.destroy()
    b.destroy()
  })

  it('keeps typing while offline, sends it when back, with a fresh ticket each time', async () => {
    room = new Room()
    vi.useFakeTimers()
    const tickets = { n: 0 }
    const a = window_(tickets)
    const b = window_()
    await settle()
    // The connection drops; typing goes on.
    down = true
    for (const s of [...room.sockets]) if (opened.length && s.url.includes('t1')) s.close()
    await settle()
    expect(a.status).toBe('offline')
    a.text.insert(0, 'typed offline ')
    await settle()
    expect(b.text.toString()).toBe('')
    // Back: it tries again by itself, with a new ticket.
    down = false
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    expect(a.status).toBe('live')
    expect(tickets.n).toBe(2)
    expect(b.text.toString()).toBe('typed offline ')
    vi.useRealTimers()
    a.destroy()
    b.destroy()
  })

  it('tells who it is, and goes quiet in the others’ view when it leaves', async () => {
    room = new Room()
    const a = window_()
    const b = window_()
    await settle()
    a.setUser({ account: '1001', name: 'Julius', picture: '', color: '#1e4fbf' })
    await settle()
    const seen = () => [...b.awareness.getStates().values()].map((s) => (s as { user?: { name: string } }).user?.name).filter(Boolean)
    expect(seen()).toEqual(['Julius'])
    a.destroy()
    await settle()
    expect(seen()).toEqual([])
    b.destroy()
  })

  it('is not live when the server says no', async () => {
    const off = new LiveNote(8, async () => {
      throw new NotLive()
    })
    await settle()
    expect(off.status).toBe('off')
    off.destroy()
  })
})
