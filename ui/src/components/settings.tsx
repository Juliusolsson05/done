import { currentPlatform, downloadOffer, modifierKey, readPlatform, windowsDevice, type Download } from '@/lib/platform'
import { CLOUD_URL } from '@/lib/cloud'
import { Avatar } from '@/components/avatars'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ViewHeader } from '@/components/list-view'
import { useAccount } from '@/components/sign-in'
import { WorkspacePage, WorkspacesPane } from '@/components/workspaces-settings'
import { canSignIn, canSignInWithApple, isDesktop, isIosApp, MAC_DOWNLOAD, WINDOWS_DOWNLOAD, needsAppleVerification, openLink, REMOTE_MCP, restart, signIn, signInWithApple, signInWithReviewPassword, waitingHere } from '@/lib/backend'
import { deletionWarning, signOutQuestion, waitingMessage, type Held } from '@/lib/account-switch'
import { deleteAccountHere, prepareToLeave, signOutChecked } from '@/lib/leave'
import { useApp } from '@/lib/app-context'
import { play, setSoundsOn, soundsOn } from '@/lib/sounds'
import { useLayout } from '@/hooks/use-mobile'

// On a touch screen the buttons and the switch here take a 44 point tap
// (they were 28, #109); a mouse never matches pointer-coarse.
function Pane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex max-w-2xl flex-col gap-3 pointer-coarse:[&_[data-slot=button]]:h-11 pointer-coarse:[&_[data-slot=switch]]:after:-inset-y-3.5">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Snippet({ label, text }: { label: string; text: string }) {
  const { say } = useApp()
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5">{text}</pre>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(text).then(() => say('Copied'))}>
          Copy
        </Button>
      </div>
    </div>
  )
}

function Sounds() {
  const [on, setOn] = useState(soundsOn)
  const change = (next: boolean) => {
    setSoundsOn(next)
    setOn(next)
    // Turning them on answers with one, so it is clear what was switched on.
    if (next) play('confirm')
  }
  return (
    <Pane title="Sounds">
      <div className="flex items-center gap-3">
        <Switch id="sounds" checked={on} onCheckedChange={change} />
        <Label htmlFor="sounds" className="font-normal">
          Play a quiet sound when you finish, add or change a task
        </Label>
      </div>
    </Pane>
  )
}

// The App Review login: a username and password Apple's reviewers are given
// with the submission, since they have no Google account for done. Folded
// away behind a quiet link; nobody else has a password to type.
function PasswordSignIn() {
  const { say } = useApp()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  if (!open)
    return (
      <button type="button" className="self-start text-sm text-muted-foreground underline underline-offset-2" onClick={() => setOpen(true)}>
        Sign in with a password
      </button>
    )
  const submit = () => void signInWithReviewPassword(username, password).catch((e: Error) => say(e.message))
  return (
    <form
      className="flex max-w-xs flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input placeholder="Username" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <Input placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button size="sm" type="submit" className="self-start" disabled={!username || !password}>
        Sign in
      </Button>
    </form>
  )
}

// Only where there are accounts: the hosted web app.
function AccountPane() {
  const account = useAccount()
  const { say } = useApp()
  // Deleting takes two clicks. A dialog would be the usual way, but this is
  // the one place it would be used, and the second button says all it would.
  const [sure, setSure] = useState(false)
  // Changes not sent when signing out was asked, and a sign-out under way.
  const [unsent, setUnsent] = useState<number | null>(null)
  const [leaving, setLeaving] = useState(false)
  // Changes waiting for an account this app was signed out of (a session
  // that ended, say), and those not sent when deleting was asked.
  const [waiting, setWaiting] = useState<Held | null>(null)
  const [deleteUnsent, setDeleteUnsent] = useState(0)
  useEffect(() => {
    if (!account) void waitingHere().then(setWaiting)
  }, [account])
  if (!account) {
    // An app that could sign in and has not.
    if (!canSignIn) return null
    const waits = waitingMessage(waiting)
    return (
      <Pane title="Account">
        <p className="text-muted-foreground">
          Your tasks are kept on this device. Sign in to have the same tasks here, at thedone.app and on your phone. Everything on this device
          goes up to your account, and it keeps working without a connection.
        </p>
        {waits && <p className="font-medium">{waits}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {/* Apple's sign-in first and no smaller than Google's: the App
              Store's rule for apps that offer both (guideline 4.8), and
              Apple's own button style, black with the Apple logo. */}
          {canSignInWithApple && (
            <Button size="sm" className="bg-black text-white hover:bg-black/85" onClick={() => void signInWithApple().catch((e: Error) => say(e.message))}>
              <span aria-hidden>{'\uF8FF'}</span> Sign in with Apple
            </Button>
          )}
          <Button size="sm" variant={canSignInWithApple ? 'outline' : 'default'} onClick={() => void signIn().catch((e: unknown) => say(e instanceof Error ? e.message : 'Signing in did not work. Try again.'))}>
            Sign in with Google
          </Button>
        </div>
        <PasswordSignIn />
      </Pane>
    )
  }
  const remove = () => void deleteAccountHere().catch(() => say('Your account could not be deleted. Nothing was removed.'))
  // Signing out tries one last sync; if changes are still unsent, the
  // person is asked (lib/store.ts signOutChecked).
  const leave = (force: boolean) => {
    setLeaving(true)
    void signOutChecked(force)
      .then((n) => setUnsent(n > 0 ? n : null))
      .catch(() => say('Signing out did not work. Try again.'))
      .finally(() => setLeaving(false))
  }
  return (
    <Pane title="Account">
      {/* Your Google picture, as the people in your workspaces see it. */}
      <div className="flex items-center gap-3">
        <Avatar who={{ id: account.id ?? account.email, name: account.name, email: account.email, picture: account.picture }} size="lg" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{account.name || account.email}</span>
          {account.name && <span className="truncate text-sm text-muted-foreground">{account.email}</span>}
        </div>
      </div>
      <p className="text-muted-foreground">
        {account.id?.startsWith('apple')
          ? 'Signed in with Apple.'
          : account.id === 'review'
            ? 'Signed in to the App Review account.'
            : account.picture
              ? 'Signed in with Google.'
              : 'Signed in with Google. Your Google account has no picture, so your initials stand in for it; add one there and sign in again to use it here.'}
        {needsAppleVerification && ' Verify this account once so done can sign you out when you disconnect it from Apple.'}
        {isDesktop && ' Your tasks stay on this device too and sync every few seconds when there is a connection. Signing out keeps them here.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {needsAppleVerification && (
          <Button variant="outline" size="sm" onClick={() => void signInWithApple().catch((e: Error) => say(e.message))}>
            Verify Apple Account
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={leaving} onClick={() => leave(false)}>
          {leaving ? 'Signing out…' : 'Sign out'}
        </Button>
        {sure ? (
          <>
            <Button variant="destructive" size="sm" onClick={remove}>
              Delete my account and cloud data
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSure(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setSure(true)
              // One last round, and what is still unsent is said below.
              void prepareToLeave().then(setDeleteUnsent)
            }}
          >
            Delete my account
          </Button>
        )}
      </div>
      {unsent !== null && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{signOutQuestion(unsent)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="destructive" size="sm" disabled={leaving} onClick={() => leave(true)}>
              Sign out anyway
            </Button>
            <Button variant="ghost" size="sm" disabled={leaving} onClick={() => setUnsent(null)}>
              Stay signed in
            </Button>
          </div>
        </div>
      )}
      {sure && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Your personal space and feedback will be deleted. Other members keep shared workspaces. This cannot be undone.</p>
          {deletionWarning(deleteUnsent) && <p className="font-medium text-foreground">{deletionWarning(deleteUnsent)}</p>}
          {isDesktop && <p>Local copies stay on your devices.</p>}
          {account.id?.startsWith('apple') && (
            <p>Also disconnect done in your Apple Account under Sign in with Apple.{' '}
              <button className="underline" onClick={() => openLink('https://support.apple.com/102571')}>See Apple’s instructions</button>.
            </p>
          )}
        </div>
      )}
    </Pane>
  )
}

// The iPhone and iPad app has a tasks file of its own like the Mac app
// (`isDesktop`), but no terminal for the MCP server, no ⌘ for text size and no
// self-update (the updater is the Mac's; 23 Nov audit showed all three there).
const onIos = isIosApp

const DOWNLOAD: Record<Download, { href: string; name: string }> = {
  windows: { href: WINDOWS_DOWNLOAD, name: 'Windows (x64)' },
  mac: { href: MAC_DOWNLOAD, name: 'Mac (Apple silicon)' },
}

// One button for the computer this is, the others as small links. Which
// computer is read in the page only (lib/platform.ts); nothing is sent.
function DesktopDownloads() {
  const [platform, setPlatform] = useState(currentPlatform)
  useEffect(() => void readPlatform().then(setPlatform), [])
  const offer = downloadOffer(platform)
  return (
    <>
      <p className="text-muted-foreground">The desktop app keeps your tasks on the computer and works offline.</p>
      {offer.primary === 'browser' ? (
        <p>{platform.os === 'ios' ? 'Use done in the browser: it is what you are using now.' : 'done works right here in your browser.'}</p>
      ) : (
        <Button asChild size="sm" className="self-start">
          <a href={DOWNLOAD[offer.primary].href}>{offer.label}</a>
        </Button>
      )}
      {offer.note && <p className="text-sm text-muted-foreground">{offer.note}</p>}
      <p className="text-sm text-muted-foreground">
        Also for{' '}
        {offer.also.map((d, i) => (
          <span key={d}>
            {i > 0 && ' · '}
            <a className="underline underline-offset-2 hover:text-foreground" href={DOWNLOAD[d].href}>
              {DOWNLOAD[d].name}
            </a>
          </span>
        ))}
      </p>
    </>
  )
}

export function Settings() {
  const { info, zoom, setZoom } = useApp()
  // A browser on a phone or an iPad has no terminal and no Mac to download
  // to: the Mac app and the agent commands are for a desktop browser (#109).
  const desktopBrowser = useLayout() === 'desktop'
  const account = useAccount()
  // A workspace's page opens in place of the settings, with a way back.
  const [space, setSpace] = useState<number | null>(null)
  const path = info.mcpCommand
  const commandPath = windowsDevice ? "'" + path.replaceAll("'", "''") + "'" : `"${path}"`
  if (space !== null) return <WorkspacePage id={space} onBack={() => setSpace(null)} />
  return (
    <div className="max-w-3xl">
      <ViewHeader title="Settings" />
      <div className="flex flex-col gap-8">
        <AccountPane />

        {isDesktop && (
          <Pane title="Help">
            <div className="flex flex-wrap gap-4">
              <button className="underline" onClick={() => openLink(`${CLOUD_URL ?? 'https://thedone.app'}/privacy`)}>Privacy policy</button>
              <button className="underline" onClick={() => openLink(`${CLOUD_URL ?? 'https://thedone.app'}/support`)}>Support</button>
            </div>
          </Pane>
        )}

        <WorkspacesPane onOpen={setSpace} />

        {/* The MCP server on the internet: works from any device, for apps
            like Claude that add a server by its address. It signs in to the
            same account, so it is shown wherever there is one. */}
        {account && REMOTE_MCP && (
          <Pane title="Connect Claude">
            <p className="text-muted-foreground">
              Let Claude read your tasks and notes and add, change and finish them, in the Claude app on any device. In Claude, open Settings →
              Connectors → Add custom connector, paste this address, and sign in to done when it asks.
            </p>
            <Snippet label="Connector address" text={REMOTE_MCP} />
          </Pane>
        )}

        {/* The built-in MCP server reads the tasks file on this Mac. A signed-in
            app keeps that file in step with the account, so it works there
            too; in the web app there is no file here to read. */}
        {path && (!account || isDesktop) && !onIos && (isDesktop || desktopBrowser) && (
          <Pane title="Connect an AI agent">
            <p className="text-muted-foreground">
              done has an MCP server built in. An agent connected to it can read your tasks and add, change and finish them. What it does shows up
              here within a few seconds.
            </p>
            <Snippet label={windowsDevice ? "Run in PowerShell for Claude Code" : "Claude Code: run this once in a terminal"} text={`claude mcp add done -- ${commandPath} mcp`} />
            <Snippet
              label="Other apps: add this to their MCP settings"
              text={JSON.stringify({ mcpServers: { done: { command: path, args: ['mcp'] } } }, null, 2)}
            />
          </Pane>
        )}

        {!isDesktop && (
          <Pane title="Desktop app">
            <DesktopDownloads />
          </Pane>
        )}

        <Sounds />

        {/* A browser has its own zoom and nothing to update, so these two
            are for the desktop app only. */}
        {isDesktop && !onIos && (
          <>
            <Pane title="Text size">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" aria-label="Smaller" onClick={() => setZoom(zoom - 0.1)}>
                  −
                </Button>
                <output className="min-w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</output>
                <Button variant="outline" size="sm" aria-label="Larger" onClick={() => setZoom(zoom + 0.1)}>
                  +
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setZoom(1)}>
                  Reset
                </Button>
              </div>
              <p className="text-muted-foreground">
                Also on <Kbd>{modifierKey}</Kbd> <Kbd>+</Kbd>, <Kbd>{modifierKey}</Kbd> <Kbd>−</Kbd> and <Kbd>{modifierKey}</Kbd> <Kbd>0</Kbd>.
              </p>
            </Pane>
            <Pane title={`Version ${info.version}`}>
              <p className="text-muted-foreground">
                {info.updateReady
                  ? `Version ${info.updateReady} is ready. Restart done to use it.`
                  : 'done checks for updates in the background.'}
              </p>
              {info.updateReady && (
                <Button size="sm" className="self-start" onClick={restart}>
                  Restart now
                </Button>
              )}
            </Pane>
          </>
        )}
      </div>
    </div>
  )
}
