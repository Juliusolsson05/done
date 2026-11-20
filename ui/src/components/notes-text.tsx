import type { MouseEvent } from 'react'
import { openLink } from '@/lib/backend'
import { linkParts } from '@/lib/links'
import { cn } from '@/lib/utils'

// A task's notes with their web addresses as links. A link opens the page;
// a click anywhere else on the notes opens the editor, as the title does.
// This sits beside the title's button, not inside it: a link inside a
// button is invalid and the button would take the click.
export function NotesText({ notes, onEdit, className }: { notes: string; onEdit: () => void; className?: string }) {
  const open = (event: MouseEvent, href: string) => {
    event.preventDefault()
    event.stopPropagation()
    openLink(href)
  }
  return (
    // The title's button is the keyboard way to edit; this click is for the mouse.
    <span onClick={onEdit} className={cn('w-full cursor-pointer text-xs text-muted-foreground', className)}>
      {linkParts(notes).map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            onClick={(event) => open(event, part.href!)}
            className="text-foreground/80 underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
          >
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </span>
  )
}
