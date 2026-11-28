// What deleting an account did about Sign in with Apple, said once the app
// has started over without it. The server answers the deletion with
// `apple`: 'revoked' (done ended Sign in with Apple for itself), 'not_revoked'
// (Apple did not take it), or 'none' (no grant was kept: an account signed in
// before done kept one, or not an Apple account). An older server says
// nothing, which counts as not revoked: done cannot say it was.
export type AppleAfterDeletion = 'revoked' | 'not_revoked' | 'none'

export const APPLE_DISCONNECT_HELP = 'https://support.apple.com/102571'

export function appleAfterDeletion(body: unknown): AppleAfterDeletion {
  const apple = (body as { apple?: unknown } | null)?.apple
  return apple === 'revoked' || apple === 'none' ? apple : 'not_revoked'
}

export interface DeletedNotice {
  text: string
  // Apple's own page on disconnecting an app, where the person must go.
  help?: string
}

// Nothing about Apple for an account that never signed in with it.
export function deletedNotice(signedInWithApple: boolean, apple: AppleAfterDeletion): DeletedNotice | null {
  if (!signedInWithApple) return null
  if (apple === 'revoked') return { text: 'Your account was deleted, and done disconnected Sign in with Apple.' }
  return {
    text: 'Your account was deleted. done could not disconnect Sign in with Apple, so disconnect done yourself in your Apple Account, under Sign in with Apple.',
    help: APPLE_DISCONNECT_HELP,
  }
}

// Kept across the reload that follows a deletion, until the person closes it.
const KEY = 'done-deleted-apple'

export function rememberAfterDeletion(apple: AppleAfterDeletion) {
  try {
    localStorage.setItem(KEY, apple)
  } catch {
    // Storage refused: the notice is not shown. The account is deleted all the same.
  }
}

export function noticeAfterDeletion(): DeletedNotice | null {
  try {
    const apple = localStorage.getItem(KEY)
    return apple ? deletedNotice(true, appleAfterDeletion({ apple })) : null
  } catch {
    return null
  }
}

export function forgetAfterDeletion() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do.
  }
}
