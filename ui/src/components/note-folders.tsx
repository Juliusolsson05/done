// The folders on the Notes page: All notes, each folder, and New folder.
// Beside the list on a wide screen; on a phone, a screen of its own that
// comes before the list, as in Apple Notes.
import { useState, type KeyboardEvent } from 'react'
import { ChevronRightIcon, FolderIcon, FolderPlusIcon, NotebookIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFocus } from '@/hooks/use-focus'
import { sameFolder, type Folder } from '@/lib/notes'
import { cn } from '@/lib/utils'

// A folder name typed in place: kept on Enter or when the field is left,
// dropped on Escape.
function NameField({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
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
  // The folder chosen; null is All notes.
  selected: string | null
  onSelect(folder: string | null): void
  // Each takes the name as typed; the page cleans and checks it.
  onCreate(name: string): void
  onRename(from: string, to: string): void
  onDelete(name: string): void
  // A phone: big rows that lead on to the list.
  large?: boolean
}

export function FolderNav({ folders, total, selected, onSelect, onCreate, onRename, onDelete, large = false }: FolderNavProps) {
  // 'new' while a new folder is being named, or the folder being renamed.
  const [editing, setEditing] = useState<string | null>(null)

  const row = (folder: string | null, name: string, count: number) => {
    const chosen = !large && (folder === null ? selected === null : selected !== null && sameFolder(selected, folder))
    const Icon = folder === null ? NotebookIcon : FolderIcon
    return (
      <Button
        variant="ghost"
        onClick={() => onSelect(folder)}
        aria-current={chosen ? 'true' : undefined}
        className={cn(
          'h-auto w-full justify-start gap-2 px-3 font-normal',
          large ? 'py-3 text-base' : 'py-1.5',
          chosen && 'bg-primary/10 hover:bg-primary/10',
        )}
      >
        <Icon className={cn('shrink-0', large ? 'size-5 text-primary' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        {large && <ChevronRightIcon className="text-faint" />}
      </Button>
    )
  }

  return (
    <nav aria-label="Folders" className="flex flex-col gap-0.5">
      {!large && <h2 className="px-3 pb-1 text-xs font-semibold text-muted-foreground">Folders</h2>}
      {row(null, 'All notes', total)}
      {folders.map((folder) => (
        <div key={folder.name}>
          {editing === folder.name ? (
            <NameField
              initial={folder.name}
              label="Folder name"
              onDone={(name) => {
                setEditing(null)
                if (name !== null) onRename(folder.name, name)
              }}
            />
          ) : (
            row(folder.name, folder.name, folder.count)
          )}
          {/* The chosen folder's own actions sit right under it. */}
          {!large && selected !== null && sameFolder(selected, folder.name) && editing !== folder.name && (
            <div className="flex gap-1 pb-1 pl-8">
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setEditing(folder.name)}>
                Rename
              </Button>
              <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(folder.name)}>
                Delete folder
              </Button>
            </div>
          )}
        </div>
      ))}
      {editing === 'new' ? (
        <NameField
          initial=""
          label="New folder name"
          onDone={(name) => {
            setEditing(null)
            if (name !== null) onCreate(name)
          }}
        />
      ) : (
        <Button
          variant="ghost"
          onClick={() => setEditing('new')}
          className={cn('h-auto w-full justify-start gap-2 px-3 font-normal text-muted-foreground', large ? 'py-3 text-base text-primary' : 'py-1.5')}
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
