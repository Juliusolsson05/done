import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PriorityDot } from '@/components/marks'
import { useFocus } from '@/hooks/use-focus'
import { useApp } from '@/lib/app-context'
import { play } from '@/lib/sounds'
import { isSubtask, patchTask, PRIORITY_NAME, tidyDates, type Task } from '@/lib/tasks'

function EditorForm({ task }: { task: Task }) {
  const { data, update, closeAll, removeTask } = useApp()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [start, setStart] = useState(task.start ?? '')
  const [due, setDue] = useState(task.due ?? '')
  const [priority, setPriority] = useState(task.priority)
  const [projectId, setProjectId] = useState(task.projectId)
  const titleRef = useFocus(true)

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return titleRef.current?.focus()
    const fields = { title: title.trim(), notes, priority, projectId, ...tidyDates(start || null, due || null) }
    play('confirm')
    update((d) => patchTask(d, task.id, fields))
    closeAll()
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-1">
      {/* In the title, Enter saves; in notes it is a new line. */}
      <Input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Task"
        className="border-0 px-0 text-base font-medium focus-visible:ring-0 md:text-base"
      />
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
        className="min-h-10 border-0 px-0 py-0 text-muted-foreground focus-visible:ring-0"
      />
      <Separator className="my-2" />
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs font-normal text-muted-foreground">
          Starts
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-7 w-auto px-2" />
        </Label>
        <Label className="text-xs font-normal text-muted-foreground">
          Due
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-7 w-auto px-2" />
        </Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Priority"
          value={String(priority)}
          // Pressing the chosen one again would leave no priority at all.
          onValueChange={(value) => value && setPriority(Number(value))}
        >
          {[1, 2, 3, 4].map((p) => (
            <ToggleGroupItem key={p} value={String(p)} title={PRIORITY_NAME[p]}>
              <PriorityDot priority={p} />
              {p < 4 ? p : 'None'}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* A subtask is shown under its task wherever that is, so it has no project to choose. */}
        {!isSubtask(task) && (
          <Select value={String(projectId ?? 'inbox')} onValueChange={(value) => setProjectId(value === 'inbox' ? null : Number(value))}>
            <SelectTrigger size="sm" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbox">Inbox</SelectItem>
              {data.projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => removeTask(task.id)}>
            Delete task
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={closeAll}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}

// In a list the editor takes the place of the task's row.
export function TaskEditor({ task }: { task: Task }) {
  return (
    <Card className="my-1 animate-enter p-3 shadow-md">
      <EditorForm task={task} />
    </Card>
  )
}

// Timeline and Board have no row to open in place, so there the editor
// opens over the page.
export function TaskEditorDialog({ task }: { task: Task | undefined }) {
  const { closeAll } = useApp()
  return (
    <Dialog open={task !== undefined} onOpenChange={(open) => !open && closeAll()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-xl">
        <DialogTitle className="sr-only">Edit task</DialogTitle>
        {task && <EditorForm key={task.id} task={task} />}
      </DialogContent>
    </Dialog>
  )
}
