import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ViewHeader } from '@/components/list-view'
import { useAccount } from '@/components/sign-in'
import { deleteAccount, isDesktop, restart, signOut } from '@/lib/backend'
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
  if (!account) return null
  const remove = () => void deleteAccount().catch(() => say('Your account could not be deleted. Nothing was removed.'))
  return (
    <Pane title="Account">
      <p className="text-muted-foreground">Signed in as {account.name ? `${account.name} (${account.email})` : account.email}.</p>
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
  const path = info.mcpCommand
  return (
    <div className="max-w-3xl">
      <ViewHeader title="Settings" />
      <div className="flex flex-col gap-8">
        <AccountPane />

        {/* The built-in MCP server reads the tasks file on this Mac. A hosted
            account's tasks are not in it, so the instructions would mislead. */}
        {!account && (
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
