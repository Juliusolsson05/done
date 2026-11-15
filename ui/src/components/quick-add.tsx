import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { PlusIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { PriorityDot, ProjectDot } from '@/components/marks'
import { useFocus } from '@/hooks/use-focus'
import { useApp } from '@/lib/app-context'
import { carryDismissed, dismissOnBackspace, type Dismissed } from '@/lib/date-phrases'
import { describeDay, spellDay, TODAY } from '@/lib/days'
import { readLine } from '@/lib/quick-add'
import { play } from '@/lib/sounds'
import { addTask, PRIORITY_NAME, projectName, setGoal } from '@/lib/tasks'

function QuickAdd() {
  const { data, ui, update, closeAll } = useApp()
  const [text, setText] = useState('')
  // Date phrases the user said are not dates, by pressing Backspace after them.
  const [dismissed, setDismissed] = useState<Dismissed[]>([])
  const inputRef = useFocus()
  const mirrorRef = useRef<HTMLDivElement>(null)
  // What a new task gets when the typed line does not say: the view you are in.
  const read = readLine(
    text,
    data.projects,
    TODAY,
    {
      due: ui.view.kind === 'today' || ui.asGoal ? TODAY : null,
      projectId: ui.view.kind === 'project' ? ui.view.id : null,
    },
    dismissed,
  )

  // A long line scrolls inside the field; the highlight behind it has to
  // scroll with it. Done after every render as well as on scroll, because
  // typing moves the text before any scroll event arrives.
  const followScroll = () => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
  }
  useLayoutEffect(followScroll)

  const type = (next: string) => {
    setDismissed(carryDismissed(dismissed, text, next))
    setText(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Only the plain key: Option and Command Backspace delete a word or the
    // line, and a key pressed while composing belongs to the input method.
    if (event.key !== 'Backspace' || event.metaKey || event.altKey || event.ctrlKey || event.nativeEvent.isComposing) return
    const field = event.currentTarget
    const gone = dismissOnBackspace(text, field.selectionStart, field.selectionEnd, read.date)
    if (!gone) return
    event.preventDefault()
    setDismissed([...dismissed, gone])
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!read.title) return
    const id = data.nextId
    play('add')
    update((d) => {
      const added = addTask(d, read)
      return ui.asGoal ? setGoal(added, id, TODAY) : added
    }, id)
    // Named as today's goal: there is only one, so the box closes after it.
    if (ui.asGoal) return closeAll()
    setText('') // stays open for the next task
    setDismissed([])
  }

  return (
    <Card className="my-1 animate-enter gap-2 p-3 shadow-md">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="relative">
          {/* A field cannot colour part of its own text, so the date phrase is
              marked on a copy of the line lying exactly behind the field: same
              type, same padding, never wrapped, scrolled with it. Only the
              mark shows; the copy's text is transparent. */}
          {read.date && (
            <div
              ref={mirrorRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-base font-medium whitespace-pre text-transparent"
            >
              {/* The field keeps room for the caret after the last letter; without
                  the same room here a line scrolled to its end would sit a
                  couple of pixels off. */}
              <span className="pr-1">
                {text.slice(0, read.date.start)}
                {/* The ring is the mark's breathing room. It is a shadow, so
                    unlike padding it cannot move the text off the field's. */}
                <span data-date-phrase className="rounded-sm bg-primary/15 ring-2 ring-primary/15">
                  {text.slice(read.date.start, read.date.end)}
                </span>
                {text.slice(read.date.end)}
              </span>
            </div>
          )}
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => type(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={followScroll}
            onSelect={followScroll}
            autoComplete="off"
            placeholder="What needs doing?"
            aria-label="New task"
            className="relative border-0 px-0 text-base font-medium placeholder:font-normal placeholder:text-faint focus-visible:ring-0 md:text-base"
          />
        </div>
        {/* What was read out of the line, shown as it is typed. */}
        <div className="flex min-h-6 flex-wrap items-center gap-1 text-xs text-faint">
          {!text.trim() ? (
            ui.asGoal ? (
              'The one thing that has to happen today'
            ) : (
              <>
                Try: <span className="text-muted-foreground">call the bank tomorrow p1 #home</span>
              </>
            )
          ) : (
            <>
              {ui.asGoal && (
                <Badge variant="outline" className="text-primary">
                  Today’s goal
                </Badge>
              )}
              {/* A typed date is said back with its weekday: "next friday" alone is easy to misread. */}
              {read.due && <Badge variant="outline">{read.date ? spellDay(read.due, TODAY) : describeDay(read.due, TODAY)}</Badge>}
              {read.priority < 4 && (
                <Badge variant="outline">
                  <PriorityDot priority={read.priority} />
                  {PRIORITY_NAME[read.priority]}
                </Badge>
              )}
              <Badge variant="outline">
                <ProjectDot id={read.projectId} />
                {read.projectId ? projectName(data.projects, read.projectId) : 'Inbox'}
              </Badge>
              {!read.title && <span>Add a title</span>}
            </>
          )}
        </div>
        <Separator />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Enter adds the task and keeps this open</span>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={closeAll}>
            Close
          </Button>
          <Button type="submit" size="sm" disabled={!read.title}>
            Add task
          </Button>
        </div>
      </form>
    </Card>
  )
}

// The "Add task" row, which turns into the quick add box.
export function AddRow() {
  const { ui, add } = useApp()
  if (ui.adding) return <QuickAdd />
  return (
    <Button variant="ghost" onClick={add} className="h-9 w-full justify-start gap-2.5 px-2 font-normal text-faint hover:text-muted-foreground">
      <PlusIcon className="size-4.5" />
      Add task
      <Kbd className="ml-auto">Q</Kbd>
    </Button>
  )
}
