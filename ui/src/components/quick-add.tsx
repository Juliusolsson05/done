import { useState, type FormEvent } from 'react'
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
import { describeDay, TODAY } from '@/lib/days'
import { readLine } from '@/lib/quick-add'
import { addTask, PRIORITY_NAME, projectName, setGoal } from '@/lib/tasks'

function QuickAdd() {
  const { data, ui, update, closeAll } = useApp()
  const [text, setText] = useState('')
  const inputRef = useFocus()
  // What a new task gets when the typed line does not say: the view you are in.
  const read = readLine(text, data.projects, TODAY, {
    due: ui.view.kind === 'today' || ui.asGoal ? TODAY : null,
    projectId: ui.view.kind === 'project' ? ui.view.id : null,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!read.title) return
    const id = data.nextId
    update((d) => {
      const added = addTask(d, read)
      return ui.asGoal ? setGoal(added, id, TODAY) : added
    }, id)
    // Named as today's goal: there is only one, so the box closes after it.
    if (ui.asGoal) return closeAll()
    setText('') // stays open for the next task
  }

  return (
    <Card className="my-1 animate-enter gap-2 p-3 shadow-md">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          placeholder="What needs doing?"
          aria-label="New task"
          className="border-0 px-0 text-base font-medium placeholder:font-normal placeholder:text-faint focus-visible:ring-0 md:text-base"
        />
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
              {read.due && <Badge variant="outline">{describeDay(read.due, TODAY)}</Badge>}
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
