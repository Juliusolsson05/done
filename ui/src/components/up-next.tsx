// Up next: the blocks to do after this one, each with the time it should
// take. Reached from the Focus page, under Options before a session and in
// the header while one runs, so the day can be planned before the first one
// starts. A block is added the way a session is started: the same task
// picker and the same lengths.
import { useState, useSyncExternalStore } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon, XIcon } from 'lucide-react'
import { Length } from '@/components/focus-length'
import { FocusPicker } from '@/components/focus-picker'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useApp } from '@/lib/app-context'
import { TODAY } from '@/lib/days'
import { chosenMinutes, focusTasks, type Block } from '@/lib/focus'
import { getUpNext, moveQueued, queueBlock, subscribeFocus, unqueueBlock } from '@/lib/focus-store'
import { minutesText } from '@/lib/time-sheet'

const MINUTE = 60000
// Small with a mouse, a finger's size (44 px) on touch.
const ROW_BUTTON = 'text-muted-foreground touch:size-11'

function AddBlock() {
  const { shown, ui } = useApp()
  const [taskId, setTaskId] = useState<number | null>(null)
  // A block starts at the length last chosen for focus; choosing one here
  // is for this block only and leaves the Focus page's alone.
  const [minutes, setMinutes] = useState(ui.focusMinutes)
  const [typed, setTyped] = useState('')
  const length = chosenMinutes(typed, minutes)
  // The task chosen may have been finished or deleted since.
  const chosen = focusTasks(shown.tasks, TODAY).find((t) => t.id === taskId) ?? null

  const add = () => {
    if (!queueBlock(chosen, length)) return
    // Ready for the next one: no task, the same length.
    setTaskId(null)
    if (typed.trim()) setMinutes(length)
    setTyped('')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="up-next-task" className="text-xs text-muted-foreground">
          Add a block
        </Label>
        <FocusPicker id="up-next-task" chosen={chosen} onChoose={(task) => setTaskId(task?.id ?? null)} />
      </div>
      <Length labelId="up-next-length" typed={typed} setTyped={setTyped} length={length} onChoose={setMinutes} />
      <div>
        <Button className="touch:h-11 touch:px-5" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  )
}

function Queued({ blocks }: { blocks: Block[] }) {
  const planned = blocks.reduce((sum, b) => sum + b.minutes, 0)
  if (!blocks.length) return <p className="text-muted-foreground">Nothing queued yet. When a block ends, the first one here is offered next.</p>
  return (
    <div className="flex flex-col gap-1">
      <ol aria-label="Queued blocks" className="flex flex-col divide-y">
        {blocks.map((block, i) => (
          <li key={block.id} className="flex min-h-11 items-center gap-2 py-0.5">
            <span className="w-4 shrink-0 text-right text-faint tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{block.title}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{minutesText(block.minutes * MINUTE)}</span>
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                size="icon-sm"
                className={ROW_BUTTON}
                aria-label={'Move up: ' + block.title}
                disabled={i === 0}
                onClick={() => moveQueued(block.id, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={ROW_BUTTON}
                aria-label={'Move down: ' + block.title}
                disabled={i === blocks.length - 1}
                onClick={() => moveQueued(block.id, 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" className={ROW_BUTTON} aria-label={'Remove: ' + block.title} onClick={() => unqueueBlock(block.id)}>
                <XIcon />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="pl-6 text-xs text-muted-foreground tabular-nums">{minutesText(planned * MINUTE)} planned</div>
    </div>
  )
}

export function UpNext() {
  const blocks = useSyncExternalStore(subscribeFocus, getUpNext)

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="touch:h-10">
          <ListOrderedIcon />
          Up next
          {blocks.length > 0 && <span className="text-muted-foreground tabular-nums">{blocks.length}</span>}
        </Button>
      </SheetTrigger>
      {/* On a phone it takes the whole screen: a side panel there leaves the
          titles a few letters wide. */}
      <SheetContent showCloseButton={false} className="gap-0 phone:data-[side=right]:w-full phone:data-[side=right]:max-w-none phone:data-[side=right]:border-l-0">
        <div className="flex items-center justify-between gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <SheetTitle className="text-base">Up next</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" className="-mr-2 text-muted-foreground touch:h-11">
              Done
            </Button>
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">The blocks to do after this one, and how long each should take.</SheetDescription>
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Queued blocks={blocks} />
          <AddBlock />
        </div>
      </SheetContent>
    </Sheet>
  )
}
