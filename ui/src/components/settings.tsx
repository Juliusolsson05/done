import { CLOUD_URL } from '@/lib/cloud'
import { Avatar } from '@/components/avatars'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ViewHeader } from '@/components/list-view'
import { useAccount } from '@/components/sign-in'
import { WorkspacePage, WorkspacesPane } from '@/components/workspaces-settings'
import { canSignIn, canSignInWithApple, deleteAccount, isDesktop, isIosApp, MAC_DOWNLOAD, openLink, REMOTE_MCP, restart, signIn, signInWithApple, signInWithReviewPassword, signOut } from '@/lib/backend'
import { useApp } from '@/lib/app-context'
import { play, setSoundsOn, soundsOn } from '@/lib/sounds'

function Pane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex max-w-2xl flex-col gap-3">
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
  if (!account) {
    // An app that could sign in and has not.
    if (!canSignIn) return null
    return (
      <Pane title="Account">
        <p className="text-muted-foreground">
          Your tasks are kept on this device. Sign in to have the same tasks here, at thedone.app and on your phone. Everything on this device
          goes up to your account, and it keeps working without a connection.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Apple's sign-in first and no smaller than Google's: the App
              Store's rule for apps that offer both (guideline 4.8), and
              Apple's own button style, black with the Apple logo. */}
          {canSignInWithApple && (
            <Button size="sm" className="bg-black text-white hover:bg-black/85" onClick={() => void signInWithApple().catch((e: Error) => say(e.message))}>
              <span aria-hidden>{'\uF8FF'}</span> Sign in with Apple
            </Button>
          )}
          <Button size="sm" variant={canSignInWithApple ? 'outline' : 'default'} onClick={() => void signIn().catch(() => say('Your browser could not be opened.'))}>
            Sign in with Google
          </Button>
        </div>
        <PasswordSignIn />
      </Pane>
    )
  }
  const remove = () => void deleteAccount().catch(() => say('Your account could not be deleted. Nothing was removed.'))
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
        {isDesktop && ' Your tasks stay on this device too and sync every few seconds when there is a connection. Signing out keeps them here.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
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
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSure(true)}>
            Delete my account
          </Button>
        )}
      </div>
      {sure && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Your personal space and feedback will be deleted. Other members keep shared workspaces. This cannot be undone.</p>
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

export function Settings() {
  const { info, zoom, setZoom } = useApp()
  const account = useAccount()
  // A workspace's page opens in place of the settings, with a way back.
  const [space, setSpace] = useState<number | null>(null)
  const path = info.mcpCommand
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
        {(!account || isDesktop) && !onIos && (
          <Pane title="Connect an AI agent">
            <p className="text-muted-foreground">
              done has an MCP server built in. An agent connected to it can read your tasks and add, change and finish them. What it does shows up
              here within a few seconds.
            </p>
            <Snippet label="Claude Code: run this once in a terminal" text={`claude mcp add done -- "${path}" mcp`} />
            <Snippet
              label="Other apps: add this to their MCP settings"
              text={JSON.stringify({ mcpServers: { done: { command: path, args: ['mcp'] } } }, null, 2)}
            />
          </Pane>
        )}

        {/* In a browser: the Mac app, one download away (Julius, 23 Nov). The
            app itself updates on its own, so it has no need of this. */}
        {!isDesktop && (
          <Pane title="Mac app">
            <p className="text-muted-foreground">done for Mac, for Macs with Apple silicon. It updates itself after that.</p>
            <Button asChild size="sm" className="self-start">
              <a href={MAC_DOWNLOAD}>Download for Mac</a>
            </Button>
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
                Also on <Kbd>⌘</Kbd> <Kbd>+</Kbd>, <Kbd>⌘</Kbd> <Kbd>−</Kbd> and <Kbd>⌘</Kbd> <Kbd>0</Kbd>.
              </p>
            </Pane>
            <Pane title={`Version ${info.version}`}>
              <p className="text-muted-foreground">
                {info.updateReady
                  ? `Version ${info.updateReady} is installed and starts the next time done opens.`
                  : 'done updates itself. New versions are fetched in the background and start the next time it opens.'}
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
