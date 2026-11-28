// Signing out of an app, and deleting the account: what the window does
// around the app's own clean-up (crates/core/src/account.rs).
import { focusLeaves } from '@/lib/account-switch'
import { canReplicate, deleteAccount, signOut, unsentChanges } from '@/lib/backend'
import { endFocus, getFocus } from '@/lib/focus-store'
import { getSnapshot, idle, replicateNow } from '@/lib/store'

// One last round first, so what is unsent goes up. If some is still unsent
// (no connection, the server down), nothing happens and the count comes
// back for the person to decide; `force` is their "sign out anyway".
export async function signOutChecked(force = false): Promise<number> {
  if (canReplicate && !force) {
    await replicateNow()
    await idle()
    const unsent = await unsentChanges().catch(() => 0)
    if (unsent > 0) return unsent
  }
  endLeavingFocus()
  await signOut()
  return 0
}

export async function deleteAccountHere(): Promise<void> {
  endLeavingFocus()
  await deleteAccount()
}

// A focus session on a workspace task ends first (its time goes to the
// person's own time sheet, as on Stop): that task leaves the device, and its
// title must not stay in the Dynamic Island or the menu bar.
function endLeavingFocus() {
  const { data } = getSnapshot()
  if (focusLeaves(getFocus(), data.tasks, data.team)) endFocus(false)
}
