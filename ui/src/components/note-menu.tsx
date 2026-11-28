// The open note's less used actions on an iPad, behind one ⋯: which folder
// and which project it is in, and Delete. The folders and projects are listed
// right in the menu, so moving a note is two taps, as with the pickers a Mac
// has. Delete is last, red, and outside the part that scrolls, so a long list
// of projects never hides it.
import { useState, type ReactNode } from 'react'
import { CheckIcon, FolderIcon, Trash2Icon } from 'lucide-react'
import { ProjectDot } from '@/components/marks'
import { MoreButton } from '@/components/notes-phone'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export function NoteMenu({
  folder,
  folders,
  onFolder,
  project,
  projects,
  onProject,
  onDelete,
}: {
  folder: string | null
  folders: string[]
  onFolder: (folder: string | null) => void
  project: number | null
  projects: { id: number; name: string }[]
  onProject: (id: number | null) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const pick = (act: () => void) => () => {
    setOpen(false)
    act()
  }
  const row = (key: string, content: ReactNode, on: boolean, act: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={pick(act)}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[15px] active:bg-accent"
    >
      {content}
      <CheckIcon className={cn('ml-auto size-4 shrink-0 text-primary', !on && 'invisible')} />
    </button>
  )
  const heading = (text: string) => <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{text}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <MoreButton />
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label="Note actions"
        align="end"
        className="flex max-h-[min(70svh,var(--radix-popover-content-available-height))] w-64 flex-col p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="min-h-0 overflow-y-auto">
          {heading('Folder')}
          <div role="group" aria-label="Folder">
            {row('none', <span>No folder</span>, folder === null, () => onFolder(null))}
            {folders.map((name) =>
              row(
                name,
                <>
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                </>,
                folder !== null && folder.toLocaleLowerCase() === name.toLocaleLowerCase(),
                () => onFolder(name),
              ),
            )}
          </div>
          {heading('Project')}
          <div role="group" aria-label="Project">
            {row(
              'none',
              <>
                <ProjectDot id={null} />
                <span>No project</span>
              </>,
              project === null,
              () => onProject(null),
            )}
            {projects.map((p) =>
              row(
                String(p.id),
                <>
                  <ProjectDot id={p.id} />
                  <span className="truncate">{p.name}</span>
                </>,
                project === p.id,
                () => onProject(p.id),
              ),
            )}
          </div>
        </div>
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            role="menuitem"
            onClick={pick(onDelete)}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[15px] text-destructive active:bg-destructive/10"
          >
            <Trash2Icon className="size-4 shrink-0" />
            Delete note
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
