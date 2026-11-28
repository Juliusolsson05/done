import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { forgetAfterDeletion, noticeAfterDeletion } from '@/lib/apple-after-deletion'
import { loadMe, onSignedIn, openLink, watchAppleSession } from '@/lib/backend'
import { signOutChecked } from '@/lib/leave'
import type { Account, Me } from '@/lib/me'

// The signed-in account, or null where there are no accounts (the desktop
// app, and a server running on this Mac).
const AccountContext = createContext<Account | null>(null)
export const useAccount = () => useContext(AccountContext)

function SignIn({ failed }: { failed: boolean }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">done</h1>
          <p className="text-muted-foreground">A simple to-do list. Sign in to get your own, on every device you use.</p>
        </div>
        {/* A link, not a request from a script: signing in is a trip to
            Google and back, and the browser has to make it itself. */}
        <Button asChild size="lg">
          <a href="/auth/google">Continue with Google</a>
        </Button>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            Signing in did not work. Nothing was changed; try again.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          done keeps your Google account's name, email address and picture to show who is signed in, and nothing else from Google.{' '}
          <a href="/privacy" className="underline underline-offset-2">
            Privacy
          </a>{' '}
          ·{' '}
          <a href="/terms" className="underline underline-offset-2">
            Terms
          </a>
        </p>
      </div>
    </main>
  )
}

// Said once an account was deleted and the app started over: what became of
// Sign in with Apple. Stays until it is closed, since what it asks is a must.
function AfterDeletion() {
  const [notice, setNotice] = useState(noticeAfterDeletion)
  if (!notice) return null
  return (
    <div
      role="status"
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+1rem)] z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg"
    >
      <p>
        {notice.text}
        {notice.help && (
          <>
            {' '}
            <button className="underline" onClick={() => openLink(notice.help!)}>
              See Apple’s instructions
            </button>
            .
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="self-end"
        onClick={() => {
          forgetAfterDeletion()
          setNotice(null)
        }}
      >
        OK
      </Button>
    </div>
  )
}

// Stands in front of the whole app. The app loads tasks as soon as it is
// shown, so it is only shown once there is someone to load them for.
export function Gate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  // When Apple ends the credential, the window's own sign-out: it also ends
  // a focus session on a workspace task (lib/leave.ts).
  useEffect(() => watchAppleSession(() => signOutChecked(true, 'ended')), [])
  useEffect(() => {
    // If the question cannot be asked at all the app is shown anyway, and
    // says what is wrong in its own words when its first load fails.
    loadMe().then(setMe, () => setMe({ mode: 'local' }))
    // In an app: the browser has handed back a finished sign-in. Starting
    // over is the simplest way for every part to see the account's tasks.
    return onSignedIn(() => location.reload())
  }, [])
  if (me === null) return null
  if (me.mode === 'cloud' && me.account === null) {
    return (
      <>
        <AfterDeletion />
        <SignIn failed={new URLSearchParams(location.search).get('signin') === 'failed'} />
      </>
    )
  }
  return (
    <AccountContext.Provider value={me.mode === 'cloud' ? me.account : null}>
      <AfterDeletion />
      {children}
    </AccountContext.Provider>
  )
}
