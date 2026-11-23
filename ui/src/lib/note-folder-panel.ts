// The Notes page's folders, for the sidebar. The page owns the notes and
// what can be done to their folders; while it is open it publishes them
// here, and the sidebar lists the folders under Notes and calls back into
// the page. Closed, there is nothing to list.
import type { Folder } from '@/lib/notes'

export interface FolderPanel {
  folders: Folder[]
  // How many notes there are in all, for All notes.
  total: number
  // The folder chosen; null is All notes.
  selected: string | null
  select(folder: string | null): void
  create(name: string): void
  rename(from: string, to: string): void
  remove(name: string): void
  // A new note in this folder (null: in none).
  newNote(folder: string | null): void
}

// What is being named in the sidebar: a folder's name while it is renamed,
// or NEW_FOLDER while a new one is named. A folder name never starts with a
// space, so this can never be one.
export const NEW_FOLDER = ' new'

let panel: FolderPanel | null = null
let naming: string | null = null
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}

export const subscribeFolderPanel = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getFolderPanel = (): FolderPanel | null => panel
export const getNamingFolder = (): string | null => naming

export function publishFolderPanel(next: FolderPanel | null) {
  panel = next
  if (!next) naming = null
  emit()
}
export function nameFolder(name: string | null) {
  naming = name
  emit()
}
