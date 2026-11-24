import { Avatar } from '@/components/avatars'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ViewHeader } from '@/components/list-view'
import { useAccount } from '@/components/sign-in'
import { WorkspacePage, WorkspacesPane } from '@/components/workspaces-settings'
import { canSignIn, deleteAccount, isDesktop, MAC_DOWNLOAD, restart, signIn, signOut } from '@/lib/backend'
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
        <Button size="sm" className="self-start" onClick={() => void signIn().catch(() => say('Your browser could not be opened.'))}>
          Sign in with Google
        </Button>
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
        {account.picture ? 'Signed in with Google.' : 'Signed in with Google. Your Google account has no picture, so your initials stand in for it; add one there and sign in again to use it here.'}
        {isDesktop && ' Your tasks stay on this device too and sync every few seconds when there is a connection. Signing out keeps them here.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
        {sure ? (
          <>
            <Button variant="destructive" size="sm" onClick={remove}>
              Delete every task and my account
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
      {sure && <p className="text-sm text-muted-foreground">This removes all your tasks, projects and time sheet for good. It cannot be undone.</p>}
    </Pane>
  )
}

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

        <WorkspacesPane onOpen={setSpace} />

        {/* The built-in MCP server reads the tasks file on this Mac. A signed-in
            app keeps that file in step with the account, so it works there
            too; in the web app there is no file here to read. */}
        {(!account || isDesktop) && (
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
        {isDesktop && (
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
