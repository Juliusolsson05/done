// A hosted account, as the Mac and iPhone apps know it. A browser on the
// hosted web app needs none of this: there the server's cookie does the work.
import type { Account } from '@/lib/me'

// Which server this app signs in to. Decided when the app is built; without
// it the app has no sign-in and works on its local file only.
export const CLOUD_URL: string | null = ((import.meta.env?.VITE_DONE_CLOUD_URL as string | undefined) ?? '').replace(/\/+$/, '') || null

export interface CloudSession {
  token: string
  account: Account
  appleUser?: string
}

const SESSION = 'done-cloud-session'
// The secret of a sign-in that has been started and not yet finished.
const SECRET = 'done-cloud-secret'

// Storage can be switched off or full. Then the app is simply not signed in.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Nothing to do: it will not be there next time, which is the safe side.
  }
}

export function cloudSession(): CloudSession | null {
  if (!CLOUD_URL) return null
  try {
    const session = JSON.parse(read(SESSION) ?? 'null') as CloudSession | null
    return session && typeof session.token === 'string' && typeof session.account?.email === 'string' ? session : null
  } catch {
    return null
  }
}

export const forgetCloudSession = () => write(SESSION, null)

// The SHA-256 of the secret, in hex: what the server is given at the start,
// and what it checks the secret against at the end.
export async function challengeOf(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// The server identifies Apple accounts by the first 40 hex digits of the
// subject's SHA-256. Keep the native subject only with that verified session.
export async function appleSession(session: CloudSession, user: string): Promise<CloudSession> {
  if (!user || session.account.id !== 'apple' + (await challengeOf(user)).slice(0, 40)) {
    throw new Error('Choose the Apple Account you used to sign in to done.')
  }
  return { ...session, appleUser: user }
}

export const sameAppleSession = (current: CloudSession | null, watched: CloudSession): boolean =>
  Boolean(watched.appleUser && current?.token === watched.token && current.appleUser === watched.appleUser && current.account.id === watched.account.id)

export async function rememberAppleUser(expected: CloudSession, user: string): Promise<void> {
  const bound = await appleSession(expected, user)
  if (cloudSession()?.token !== expected.token) throw new Error('Your account changed. Try again.')
  write(SESSION, JSON.stringify(bound))
}

// The code in a link the browser handed back, or null for any other link.
export function codeIn(link: string): string | null {
  try {
    const url = new URL(link)
    // `done://auth?code=…`. Browsers disagree on whether "auth" is the host
    // or the path of such a link, so both are looked at.
    if (url.protocol !== 'done:' || (url.host !== 'auth' && url.pathname.replace(/^\/+/, '') !== 'auth')) return null
    return url.searchParams.get('code')
  } catch {
    return null
  }
}

// Sends the person to their browser to sign in. `open` opens a page there.
export async function beginSignIn(open: (url: string) => Promise<void>): Promise<void> {
  if (!CLOUD_URL) return
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  write(SECRET, secret)
  await open(`${CLOUD_URL}/auth/google?app_challenge=${await challengeOf(secret)}`)
}

// Trades the code from a link for a token and keeps it. True when the app is
// now signed in.
export async function finishSignIn(link: string): Promise<boolean> {
  const code = codeIn(link)
  const secret = read(SECRET)
  if (!CLOUD_URL || !code || !secret) return false
  const response = await fetch(`${CLOUD_URL}/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier: secret }),
  })
  // Used once, whether or not it worked: a second link must not finish it again.
  write(SECRET, null)
  if (!response.ok) return false
  write(SESSION, JSON.stringify(await response.json()))
  return cloudSession() !== null
}

// Sign-ins that finish in one request rather than a trip through the
// browser: Apple's (the iPhone app hands over the token Apple gave it) and
// the App Review login. Both answer `{token, account}`, like `/auth/exchange`.
// Throws with the server's own words when it says no.
async function signInWith(path: string, body: unknown, appleUser?: string): Promise<void> {
  if (!CLOUD_URL) throw new Error('This app has no account to sign in to.')
  const response = await fetch(`${CLOUD_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error || 'Signing in did not work. Try again.')
  const session = data as CloudSession
  write(SESSION, JSON.stringify(appleUser ? await appleSession(session, appleUser) : session))
  if (cloudSession() === null) throw new Error('Signing in did not work. Try again.')
}

export const signInWithAppleToken = (token: string, name: string, user: string) => signInWith('/auth/apple', { identity_token: token, name }, user)
export const signInWithPassword = (username: string, password: string) => signInWith('/auth/review', { username, password })
