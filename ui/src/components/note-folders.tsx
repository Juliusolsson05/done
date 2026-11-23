// The folders on the Notes page: All notes, each folder, and New folder.
// Beside the list on a wide screen; on a phone, a screen of its own that
// comes before the list, as in Apple Notes.
import { useState, type KeyboardEvent } from 'react'
import { ChevronRightIcon, FolderIcon, FolderPlusIcon, NotebookIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFocus } from '@/hooks/use-focus'
import type { Folder } from '@/lib/notes'

// A folder name typed in place: kept on Enter or when the field is left,
// dropped on Escape.
export function NameField({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
  const ref = useFocus(true)
  const [value, setValue] = useState(initial)
  // Enter blurs the field, and the blur would keep the name a second time.
  const [settled, setSettled] = useState(false)
  const settle = (name: string | null) => {
    if (settled) return
    setSettled(true)
    onDone(name)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') settle(value)
    if (event.key === 'Escape') {
      // Only this field closes; the page's own Escape is left alone.
      event.preventDefault()
      event.stopPropagation()
      settle(null)
    }
  }
  return (
    <Input
      ref={ref}
      value={value}
      aria-label={label}
      placeholder="Folder name"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => settle(value)}
      className="h-8"
    />
  )
}

export interface FolderNavProps {
  folders: Folder[]
  total: number
  onSelect(folder: string | null): void
  // Takes the name as typed; the page cleans and checks it.
  onCreate(name: string): void
}

// On a phone: the folders as a screen of their own, big rows that lead on to
// a folder's notes. A folder is renamed or deleted from its own list. (On a
// wide screen the folders are in the sidebar instead.)
export function FolderNav({ folders, total, onSelect, onCreate }: FolderNavProps) {
  const [naming, setNaming] = useState(false)

  const row = (folder: string | null, name: string, count: number) => {
    const Icon = folder === null ? NotebookIcon : FolderIcon
    return (
      <Button
        key={name}
        variant="ghost"
        onClick={() => onSelect(folder)}
        className="h-auto w-full justify-start gap-2 px-3 py-3 text-base font-normal"
      >
        <Icon className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        <ChevronRightIcon className="text-faint" />
      </Button>
    )
  }

  return (
    <nav aria-label="Folders" className="flex flex-col gap-0.5">
      {row(null, 'All notes', total)}
      {folders.map((folder) => row(folder.name, folder.name, folder.count))}
      {naming ? (
        <NameField
          initial=""
          label="New folder name"
          onDone={(name) => {
            setNaming(false)
            if (name !== null) onCreate(name)
          }}
        />
      ) : (
        <Button
          variant="ghost"
          onClick={() => setNaming(true)}
          className="h-auto w-full justify-start gap-2 px-3 py-3 text-base font-normal text-primary"
        >
          <FolderPlusIcon />
          New folder
        </Button>
      )}
    </nav>
  )
}

// On a phone, a folder's own actions, in its list's header.
export function FolderActions({
  name,
  onRename,
  onDelete,
}: {
  name: string
  onRename(from: string, to: string): void
  onDelete(name: string): void
}) {
  const [renaming, setRenaming] = useState(false)
  if (renaming)
    return (
      <NameField
        initial={name}
        label="Folder name"
        onDone={(to) => {
          setRenaming(false)
          if (to !== null) onRename(name, to)
        }}
      />
    )
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setRenaming(true)}>
        Rename
      </Button>
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(name)}>
        Delete
      </Button>
    </div>
  )
}
