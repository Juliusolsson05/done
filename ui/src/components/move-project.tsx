// The one question before a project changes space: it names who will see it
// (moving in) or who will no longer (moving out). Asked from Settings and
// from a project's right-click menu, through lib/move-store.
import { useState } from 'react'
import { Avatars } from '@/components/avatars'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { workspaceCalls } from '@/lib/backend'
import { useApp } from '@/lib/app-context'
import { askMove, useMoveAsk } from '@/lib/move-store'
import { firstName, namesOf } from '@/lib/team'
import { moveWords } from '@/lib/workspace-view'

export function MoveProjectDialog() {
  const ask = useMoveAsk()
  const { data, team, me, teamAct } = useApp()
  const [busy, setBusy] = useState(false)
  const words = ask && team && me ? moveWords(data, team, ask.project, ask.to, me) : null
  const close = () => {
    if (!busy) askMove(null)
  }
  const move = async () => {
    if (!ask || !words) return
    setBusy(true)
    const target = team?.spaces.find((s) => s.id === ask.to)
    const ok = await teamAct(
      () => workspaceCalls.moveProject(ask.project, ask.to),
      target?.kind === 'workspace' ? `Moved to ${target.name}` : 'Moved to your own space',
    )
    setBusy(false)
    // A refusal (moving out of someone else's workspace) is said by teamAct;
    // the question stays so it can be read against the answer.
    if (ok) askMove(null)
  }
  return (
    <Dialog open={words !== null} onOpenChange={(open) => !open && close()}>
      {words && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg tracking-[-0.01em]">{words.title}</DialogTitle>
            <DialogDescription>{words.body}</DialogDescription>
          </DialogHeader>
          {words.people.length > 0 && (
            <div className="flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <Avatars people={words.people} ring="ring-muted" />
              <span>{namesOf(words.people.map((m) => firstName(m.name) || m.email))}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={move} disabled={busy}>
              {words.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
