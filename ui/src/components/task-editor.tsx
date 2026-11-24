import { useRef, useState, type FormEvent } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { TaskCheck } from '@/components/task-row'
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
import { AssigneePage, AssigneePicker, AssigneeRow } from '@/components/assignees'
import { useFocus } from '@/hooks/use-focus'
import { useApp } from '@/lib/app-context'
import { play } from '@/lib/sounds'
import { addSubtask, isSubtask, patchTask, PRIORITY_NAME, setGoal, subtasksOf, tidyDates, type Task } from '@/lib/tasks'
import { describeDay, TODAY, type Day } from '@/lib/days'
import { cn } from '@/lib/utils'

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
          {[0, 1, 2, 3, 4].map((p) => (
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
        {/* Who is on it: only on a workspace's task. Saved as it is chosen. */}
        <AssigneePicker task={task} />
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

// On a phone a task opens as a sheet from the bottom, like a reminder's
// details on iOS: Cancel and Done at the top, the title and notes in one
// group, then one row per setting. Dates, priority and list use the
// system's own pickers (a date input and a select show iOS's wheels and
// calendar), so choosing feels like any other iPhone app.
export function TaskSheet({ task }: { task: Task | undefined }) {
  if (!task) return null
  return <Sheet key={task.id} task={task} />
}

function Sheet({ task }: { task: Task }) {
  const { data, update, closeAll, removeTask } = useApp()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [start, setStart] = useState(task.start ?? '')
  const [due, setDue] = useState(task.due ?? '')
  const [priority, setPriority] = useState(task.priority)
  const [projectId, setProjectId] = useState(task.projectId)
  const [leaving, setLeaving] = useState(false)
  // Choosing who is on it: a page of its own within the sheet.
  const [choosing, setChoosing] = useState(false)
  // Pulled down by the grabber: how far, while the finger is on it.
  const [pull, setPull] = useState(0)
  const pullFrom = useRef<number | null>(null)

  // The sheet slides back down before it is gone.
  const close = (then: () => void) => {
    setLeaving(true)
    setTimeout(then, 220)
  }
  const done = () => {
    if (!title.trim()) return
    const fields = { title: title.trim(), notes, priority, projectId, ...tidyDates(start || null, due || null) }
    play('confirm')
    close(() => {
      update((d) => patchTask(d, task.id, fields))
      closeAll()
    })
  }

  const row = 'flex min-h-11 items-center gap-3 border-b border-border py-1.5 pr-4 last:border-b-0'
  const value = 'min-w-0 flex-1 appearance-none bg-transparent text-right text-body text-primary outline-none'
  return (
    <div className="fixed inset-0 z-50">
      <div className={cn('absolute inset-0 bg-black/40 transition-opacity duration-200', leaving ? 'opacity-0' : 'animate-in fade-in')} onClick={() => close(closeAll)} />
      <div
        role="dialog"
        aria-label="Details"
        style={{ transform: pull ? `translateY(${pull}px)` : undefined }}
        className={cn(
          'absolute inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] bottom-0 flex flex-col overflow-hidden rounded-t-2xl bg-grouped shadow-2xl',
          leaving ? 'translate-y-full transition-transform duration-200 ease-in' : !pull && 'animate-rise',
        )}
      >
        <div
          className="shrink-0 touch-none"
          onTouchStart={(e) => (pullFrom.current = e.touches[0].clientY)}
          onTouchMove={(e) => pullFrom.current !== null && setPull(Math.max(0, e.touches[0].clientY - pullFrom.current))}
          onTouchEnd={() => {
            pullFrom.current = null
            if (pull > 120) close(closeAll)
            else setPull(0)
          }}
        >
          <div className="mx-auto mt-1.5 h-1.25 w-9 rounded-full bg-foreground/20" />
          <div className="flex h-11 items-center px-4">
            <button type="button" onClick={() => close(closeAll)} className="text-body text-primary active:opacity-40">
              Cancel
            </button>
            <span className="flex-1 text-center text-body font-semibold">Details</span>
            <button type="button" onClick={done} disabled={!title.trim()} className="text-body font-semibold text-primary active:opacity-40 disabled:text-tertiary">
              Done
            </button>
          </div>
        </div>
        {choosing && (
          <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
            <AssigneePage task={task} onBack={() => setChoosing(false)} />
          </div>
        )}
        {/* Each group keeps its height and the sheet scrolls: as flex items they
            would otherwise shrink to fit, clipping the last rows (24 Nov). */}
        <div className={cn('flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+2rem)] [&>*]:shrink-0', choosing && 'hidden')}>
          <div className="overflow-hidden rounded-xl bg-background pl-4">
            <textarea
              value={title}
              // A title is one line of text, however long; Return is Done.
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), done())}
              aria-label="Title"
              placeholder="Title"
              rows={1}
              enterKeyHint="done"
              className="field-sizing-content w-full resize-none border-b border-border bg-transparent py-2.5 pr-4 text-body outline-none"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label="Notes"
              placeholder="Notes"
              rows={3}
              className="field-sizing-content min-h-20 w-full resize-none bg-transparent py-2.5 pr-4 text-body text-muted-foreground outline-none"
            />
          </div>
          <div className="overflow-hidden rounded-xl bg-background pl-4">
            <DateRow label="Date" day={due} set={setDue} className={row} />
            <DateRow label="Starts" day={start} set={setStart} className={row} />
            <label className={row}>
              <span className="text-body">Priority</span>
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={cn(value, priority === 4 && 'text-tertiary')} dir="rtl">
                {[4, 3, 2, 1, 0].map((p) => (
                  <option key={p} value={p}>
                    {p === 4 ? 'None' : PRIORITY_NAME[p]}
                  </option>
                ))}
              </select>
            </label>
            {/* A subtask is shown under its task wherever that is, so it has no list to choose. */}
            {!isSubtask(task) && (
              <label className={row}>
                <span className="text-body">List</span>
                <select
                  value={String(projectId ?? 'inbox')}
                  onChange={(e) => setProjectId(e.target.value === 'inbox' ? null : Number(e.target.value))}
                  className={value}
                  dir="rtl"
                >
                  <option value="inbox">Inbox</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <AssigneeRow task={task} className={row} onOpen={() => setChoosing(true)} />
          </div>
          {/* What the long-press menu offers on a Mac, here as rows a finger can
              reach (23 Nov audit: the phone sheet had no subtasks, status,
              focus or goal). A subtask has none of these. */}
          {!isSubtask(task) && <SheetSubtasks parent={task} />}
          {!isSubtask(task) && <SheetActions task={task} row={row} value={value} close={close} />}
          <button
            type="button"
            onClick={() => close(() => removeTask(task.id))}
            className="h-11 rounded-xl bg-background text-body text-destructive active:bg-secondary"
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  )
}

// The task's subtasks in the sheet: tick one off, or add another with Return.
function SheetSubtasks({ parent }: { parent: Task }) {
  const { data, update, complete, reopen } = useApp()
  const [title, setTitle] = useState('')
  const subtasks = subtasksOf(data.tasks, parent.id)
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    play('confirm')
    update((d) => addSubtask(d, parent.id, title.trim()))
    setTitle('')
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-4 text-footnote text-secondary-foreground uppercase">Subtasks</h3>
      <div className="overflow-hidden rounded-xl bg-background pl-4">
        {subtasks.map((sub) => (
          <div key={sub.id} className="flex min-h-11 items-center gap-3 border-b border-border py-1.5 pr-4">
            <TaskCheck task={sub} checked={!!sub.done} onChange={() => (sub.done ? reopen(sub.id) : complete(sub.id))} className="size-5" />
            <span className={cn('min-w-0 flex-1 text-body wrap-anywhere', sub.done && 'text-tertiary line-through')}>{sub.title}</span>
          </div>
        ))}
        <form onSubmit={add} className="flex min-h-11 items-center gap-3 pr-4">
          <PlusIcon className="size-5 text-tertiary" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add subtask"
            aria-label="Add subtask"
            enterKeyHint="done"
            className="min-w-0 flex-1 bg-transparent text-body outline-none"
          />
        </form>
      </div>
    </section>
  )
}

// Status, focus and today's goal: saved at once, as the long-press menu does.
function SheetActions({ task, row, value, close }: { task: Task; row: string; value: string; close: (then: () => void) => void }) {
  const { update, me, focusOn, closeAll } = useApp()
  const goal = task.goalDay === TODAY
  const change: typeof update = (fn, notice) => {
    play('confirm')
    update(fn, notice)
  }
  return (
    <div className="overflow-hidden rounded-xl bg-background pl-4">
      <label className={row}>
        <span className="text-body">Status</span>
        <select
          value={task.status === 'doing' ? 'doing' : 'todo'}
          onChange={(e) => change((d) => patchTask(d, task.id, { status: e.target.value === 'doing' ? 'doing' : undefined }))}
          className={value}
          dir="rtl"
        >
          <option value="todo">To do</option>
          <option value="doing">In progress</option>
        </select>
      </label>
      <button
        type="button"
        className={cn(row, 'w-full text-left text-body text-primary active:bg-secondary')}
        onClick={() =>
          change((d) => (goal ? patchTask(d, task.id, { goalDay: null, goalBy: null }) : setGoal(d, task.id, TODAY, me)), task.id)
        }
      >
        {goal ? 'Remove as today’s goal' : 'Make today’s goal'}
      </button>
      <button type="button" className={cn(row, 'w-full text-left text-body text-primary active:bg-secondary')} onClick={() => close(() => (closeAll(), focusOn(task.id)))}>
        Focus on this
      </button>
    </div>
  )
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Clear"
      onClick={(e) => {
        e.preventDefault()
        onClick()
      }}
      className="-mr-1 flex size-6 items-center justify-center rounded-full bg-secondary text-tertiary"
    >
      <XIcon className="size-3.5" strokeWidth={3} />
    </button>
  )
}

// A date row: the day in words ("Today", "Sat 22 Nov"), and under it, see-
// through, the date input that opens iOS's own date picker when tapped.
function DateRow({ label, day, set, className }: { label: string; day: string; set: (day: string) => void; className: string }) {
  return (
    <div className={className}>
      <span className="text-body">{label}</span>
      <span className="relative min-w-0 flex-1 text-right text-body text-primary">
        {day ? describeDay(day as Day, TODAY) : <span className="text-tertiary">None</span>}
        <input
          type="date"
          aria-label={label}
          value={day}
          onChange={(e) => set(e.target.value)}
          className="absolute inset-0 w-full opacity-0"
        />
      </span>
      {day && <ClearButton onClick={() => set('')} />}
    </div>
  )
}
