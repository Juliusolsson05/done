// Signing out of an app, and deleting the account: what the window does
// around the app's own clean-up (crates/core/src/account.rs).
import { focusLeaves } from '@/lib/account-switch'
import { canReplicate, deleteAccount, signOut, unsentChanges } from '@/lib/backend'
import { endFocus, getFocus } from '@/lib/focus-store'
import { getSnapshot, idle, replicateNow, resumeSyncing, stopSyncing } from '@/lib/store'

// One last round, so what is unsent goes up; then how much is still unsent
// (no connection, the server down), for the person to decide on. Asked
// before signing out and before deleting the account.
export async function prepareToLeave(): Promise<number> {
  if (!canReplicate) return 0
  await replicateNow()
  await idle()
  return unsentChanges().catch(() => 0)
}

// Signing out. Returns what is still unsent, and does nothing, unless
// `force`: the person's "sign out anyway". `how` is 'ended' where the person
// did not choose this for the account the file holds (the held dialog): its
// unsent changes then stay for when it signs in again.
// Syncing stops and the round in flight is waited for first, so no reply
// for the account is taken in after its rows were taken off.
export async function signOutChecked(force = false, how: 'signed-out' | 'ended' = 'signed-out'): Promise<number> {
  if (!force) {
    const unsent = await prepareToLeave()
    if (unsent > 0) return unsent
  }
  stopSyncing()
  await idle()
  endLeavingFocus()
  try {
    await signOut(how)
  } catch (error) {
    resumeSyncing()
    throw error
  }
  return 0
}

export async function deleteAccountHere(): Promise<void> {
  stopSyncing()
  await idle()
  endLeavingFocus()
  try {
    await deleteAccount()
  } catch (error) {
    resumeSyncing()
    throw error
  }
}

// A focus session on a workspace task ends first (its time goes to the
// person's own time sheet, as on Stop): that task leaves the device, and its
// title must not stay in the Dynamic Island or the menu bar.
function endLeavingFocus() {
  const { data } = getSnapshot()
  if (focusLeaves(getFocus(), data.tasks, data.team)) endFocus(false)
}
