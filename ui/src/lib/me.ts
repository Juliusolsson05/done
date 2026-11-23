// Who the interface is talking to. The desktop app and a server on this Mac
// have no accounts ('local'). The hosted server has ('cloud'), and there the
// account is null until someone has signed in.
export interface Account {
  // The account's id, where the server says it (it does since workspaces).
  id?: string
  email: string
  name: string
  picture: string
}
export type Me = { mode: 'local' } | { mode: 'cloud'; account: Account | null }

// What a server's answer to "who am I" means. Anything unexpected counts as
// local: an older server on this Mac has no such call, and must keep working.
export function readMe(status: number, body: unknown): Me {
  const me = body as { mode?: string; account?: Account | null } | null
  if (status === 200 && me?.mode === 'cloud') return { mode: 'cloud', account: me.account ?? null }
  return { mode: 'local' }
}
