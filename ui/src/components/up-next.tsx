// Up next: the blocks to do after this one, each with the time it should
// take. Reached from a button in the Focus view's corner, in setup and while
// a block runs, so the day can be planned before the first one starts.
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useApp } from '@/lib/app-context'
import { TODAY } from '@/lib/days'
import { DEFAULT_MINUTES, focusTasks, MAX_MINUTES } from '@/lib/focus'
import { getUpNext, moveQueued, queueBlock, subscribeFocus, unqueueBlock } from '@/lib/focus-store'
import { minutesText } from '@/lib/time-sheet'

const MINUTE = 60000
// A select cannot have an empty value, so "no task" has a name.
const NOTHING = 'none'

function AddBlock() {
  const { data } = useApp()
  const tasks = focusTasks(data.tasks, TODAY)
  const [pick, setPick] = useState(NOTHING)
  const [minutes, setMinutes] = useState('')
  // The task chosen may have been finished or deleted since.
  const chosen = tasks.find((t) => String(t.id) === pick) ?? null
  const add = (event: FormEvent) => {
    event.preventDefault()
    // An empty field means the usual length rather than refusing the block.
    if (!queueBlock(chosen, minutes === '' ? DEFAULT_MINUTES : Number(minutes))) return
    setPick(NOTHING)
    setMinutes('')
  }
  return (
    <form onSubmit={add} className="flex flex-col gap-2">
      <Label htmlFor="up-next-task" className="text-xs text-muted-foreground">
        Add a block
      </Label>
      <Select value={chosen ? pick : NOTHING} onValueChange={setPick}>
        <SelectTrigger id="up-next-task" className="w-full">
          <SelectValue />
        </SelectTrigger>
        {/* Held to the panel's width: a long task title would otherwise pull
            the list out across the page behind it. */}
        <SelectContent position="popper" className="max-w-(--radix-select-trigger-width)">
          <SelectItem value={NOTHING}>Nothing in particular</SelectItem>
          {tasks.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              <span className="truncate">{t.title}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={MAX_MINUTES}
          placeholder={String(DEFAULT_MINUTES)}
          aria-label="Estimate in minutes"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="h-8 w-24"
        />
        <span className="text-muted-foreground">min</span>
        <Button type="submit" variant="outline" size="sm" className="ml-auto">
          Add
        </Button>
      </div>
    </form>
  )
}

export function UpNext() {
  const blocks = useSyncExternalStore(subscribeFocus, getUpNext)
  const planned = blocks.reduce((sum, b) => sum + b.minutes, 0)

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <ListOrderedIcon />
          Up next
          {blocks.length > 0 && <span className="text-muted-foreground tabular-nums">{blocks.length}</span>}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Up next</SheetTitle>
          <SheetDescription>What comes after this block, and how long you expect it to take.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4">
          {blocks.length > 0 ? (
            <div className="flex flex-col gap-1">
              <ol className="flex flex-col">
                {blocks.map((block, i) => (
                  <li key={block.id} className="flex items-center gap-2 py-0.5">
                    <span className="w-4 text-right text-faint tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{block.title}</span>
                    <span className="text-muted-foreground tabular-nums">{minutesText(block.minutes * MINUTE)}</span>
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        aria-label={'Move up: ' + block.title}
                        disabled={i === 0}
                        onClick={() => moveQueued(block.id, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        aria-label={'Move down: ' + block.title}
                        disabled={i === blocks.length - 1}
                        onClick={() => moveQueued(block.id, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        aria-label={'Remove: ' + block.title}
                        onClick={() => unqueueBlock(block.id)}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="pl-6 text-xs text-muted-foreground tabular-nums">{minutesText(planned * MINUTE)} planned</div>
            </div>
          ) : (
            <p className="text-muted-foreground">Nothing queued. When a block ends, the first one here is offered to start next.</p>
          )}
          <AddBlock />
        </div>
      </SheetContent>
    </Sheet>
  )
}
