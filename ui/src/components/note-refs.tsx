// Above a note while it is written: the tasks it mentions and the links in
// it, to go to with one click. Many of them fold into one line with a +.
import { useState } from 'react'
import { ExternalLinkIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { MentionChips } from '@/components/task-mention'
import { Button } from '@/components/ui/button'
import { openLink } from '@/lib/backend'
import { label } from '@/lib/links'
import { folds, isOpened, setOpened, summary } from '@/lib/note-refs'

export function NoteRefs({ note, tasks, links }: { note: number; tasks: number[]; links: string[] }) {
  const [open, setOpen] = useState(() => isOpened(note))
  if (tasks.length + links.length === 0) return null
  const folding = folds(tasks.length, links.length)
  const toggle = () => {
    setOpened(note, !open)
    setOpen(!open)
  }
  return (
    <div className="mb-3">
      {folding && (
        <Button
          variant="ghost"
          size="xs"
          onClick={toggle}
          aria-expanded={open}
          className="-ml-2 font-normal text-muted-foreground"
          title={open ? 'Fold them away' : 'Show them'}
        >
          {open ? <MinusIcon /> : <PlusIcon />}
          {summary(tasks.length, links.length)}
        </Button>
      )}
      {(!folding || open) && (
        <div className={folding ? 'mt-1.5' : undefined}>
          <MentionChips ids={tasks} />
          {links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {links.map((href) => (
                <Button key={href} variant="outline" size="xs" onClick={() => openLink(href)} className="font-normal text-muted-foreground">
                  <ExternalLinkIcon />
                  {label(href)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
