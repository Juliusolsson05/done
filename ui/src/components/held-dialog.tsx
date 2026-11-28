// Signed in where another account's tasks still are: nothing syncs until the
// person says what to do. Sign out (to sign in as that account and send what
// is unsent), or take that account's tasks off this device. See
// crates/core/src/account.rs for why nothing is sent meanwhile.
import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { heldMessage } from '@/lib/account-switch'
import { signOutChecked } from '@/lib/leave'
import { getSnapshot, subscribe, takeOver } from '@/lib/store'

export function HeldDialog() {
  const { held } = useSyncExternalStore(subscribe, getSnapshot)
  const [busy, setBusy] = useState(false)
  const words = held && heldMessage(held)
  const act = (step: () => Promise<unknown>) => {
    setBusy(true)
    void step().finally(() => setBusy(false))
  }
  return (
    // Not closed by a click outside or Escape: until it is answered nothing syncs.
    <Dialog open={words !== null}>
      {words && (
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-lg tracking-[-0.01em]">{words.title}</DialogTitle>
            <DialogDescription>{words.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => act(() => signOutChecked(true, 'ended'))}>
              Sign out
            </Button>
            <Button variant={held.unsent > 0 ? 'destructive' : 'default'} disabled={busy} onClick={() => act(takeOver)}>
              {words.drop}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
