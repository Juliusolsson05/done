// A random id for something kept in this window: a reminder, a queued
// block. crypto.randomUUID exists only in a secure context (https, the app,
// localhost); the web app opened at a plain-http address on the local
// network has none, and adding a block there would throw. getRandomValues
// has no such limit, so the same kind of id is made from it there.
export function newId(source: Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>> | undefined = globalThis.crypto): string {
  if (source?.randomUUID) return source.randomUUID()
  const bytes = new Uint8Array(16)
  if (source?.getRandomValues) source.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  // Version 4, variant 10: the shape randomUUID gives.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
